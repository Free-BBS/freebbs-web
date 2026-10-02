const { createHash } = require('node:crypto');
const {
  buildPreview,
  overlaps,
  parseKnownScheduleMessage,
  validateSuggestion,
} = require('../backend/workbench-schedule-planner');
const {
  projectCourseSchedules,
  normalizeMonday,
  normalizeTeachingWeeks,
  parseCourseSchedule,
} = require('../backend/course-schedule');
const {
  CALENDAR_PRESETS,
  SECTION_CHOICES,
  normalizeCalendarOptions,
} = require('../backend/course-calendar-options');
const { applyOverride, makePatch } = require('../backend/campus-schedule-overrides');
const { DEFAULTS } = require('../public/academic-calendar');
const { expandManualCourse } = require('../backend/manual-courses');
const { normalizePreferences, availableWindows } = require('../backend/planning-preferences');
const {
  importedSeriesKey,
  definitionFor,
  summarizeSeries,
  planMutation,
} = require('../backend/schedule-series');

function createWorkbenchPreviewApi({
  now = Date.now,
  campusCourses = [],
  campusNotices = [],
  semesterId = 'preview-semester',
} = {}) {
  const calendar = DEFAULTS[semesterId === 'preview-semester' ? '2026-2027-1' : semesterId];
  let firstWeekMonday = calendar?.firstWeekMonday || null;
  let teachingWeeks = calendar?.teachingWeeks || null;
  let options = normalizeCalendarOptions(
    { holidayPreset: calendar?.holidayPreset || '' },
    firstWeekMonday,
  );
  const personalEdits = new Map();
  const seriesDefinitions = new Map();
  let planningPreferences = normalizePreferences();
  let preferencesSaved = false;
  let savedCourses = null;
  let copiedEvents = null;
  let importPending = false;
  const sourceProjection = (includeExcluded = false) =>
    projectCourseSchedules(savedCourses || campusCourses, {
      semesterId,
      firstWeekMonday,
      teachingWeeks,
      options,
      includeExcluded,
      fetchedAt: new Date(now()).toISOString(),
    });
  const courseProjection = (includeDeleted = false) => {
    if (importPending) return { events: [], issues: [], parsedCourses: 0, totalCourses: 0 };
    if (!savedCourses && campusCourses.length) savedCourses = structuredClone(campusCourses);
    const result = copiedEvents ? structuredClone(copiedEvents) : sourceProjection(true);
    result.events = result.events
      .map((item) => {
        const seriesKey = importedSeriesKey(item);
        const row = personalEdits.get(item.publicId);
        const patch = row?.patch_json || {};
        const policy = personalEdits.get(`cs_series_${seriesKey.slice(7)}`)?.patch_json || {};
        const exception = Boolean(row && !patch.seriesManaged);
        const deleted = Boolean(
          patch.deleted ||
          (policy.suppressedFrom && item.startAt >= policy.suppressedFrom && !exception),
        );
        const edited = applyOverride(
          {
            ...item,
            connectorGeneration: 1,
            seriesKey,
            originalStartAt: item.startAt,
            originalEndAt: item.endAt,
          },
          includeDeleted && patch.deleted
            ? { ...row, patch_json: { ...patch, deleted: false } }
            : row,
        );
        return edited &&
          (includeDeleted || !deleted) &&
          (!item.calendarHoliday || edited.startAt !== item.startAt)
          ? { ...edited, deleted, exception }
          : null;
      })
      .filter(Boolean);
    return result;
  };
  const calendarStatus = () => {
    const projection = courseProjection();
    return {
      semesterId,
      imported: !importPending,
      firstWeekMonday,
      teachingWeeks,
      options,
      presets: CALENDAR_PRESETS,
      sectionChoices: SECTION_CHOICES,
      courses: campusCourses
        .map((course) => ({
          reference: course.sourceReference,
          title: course.title,
          sections: [
            ...new Set(
              parseCourseSchedule(course, {
                teachingWeeks,
                includeSections: true,
              }).sessions.flatMap((session) =>
                session.sectionStart
                  ? Array.from(
                      { length: session.sectionEnd - session.sectionStart + 1 },
                      (_, i) => session.sectionStart + i,
                    )
                  : [],
              ),
            ),
          ].filter((section) => Object.hasOwn(SECTION_CHOICES, section)),
        }))
        .filter((course) => course.sections.length),
      skippedLessons: projection.skippedLessons,
      issues: projection.issues,
      parsedCourses: projection.parsedCourses,
      totalCourses: projection.totalCourses,
      scheduledLessons: projection.events.length,
    };
  };
  const events = [
    {
      publicId: 'ws_existing',
      title: '实验室例会',
      description: '仅供工作台预览',
      startAt: new Date(now() + 2 * 3600000).toISOString(),
      endAt: new Date(now() + 3 * 3600000).toISOString(),
      allDay: false,
      status: 'confirmed',
      sourceType: 'manual',
      kind: 'event',
      version: 1,
    },
  ];
  const importantItems = [
    {
      publicId: 'wi_preview_1',
      title: '查看本周计划',
      description: '这是一条本地模拟事项，可编辑或删除。',
      dueAt: new Date(now() + 24 * 3600000).toISOString(),
      priority: 'normal',
      status: 'confirmed',
      sourceType: 'manual',
      version: 1,
    },
  ];
  const communityNotices = [
    {
      id: '12',
      kind: 'announcement',
      title: '发展端活动通知',
      body: '本周开放报名（本地模拟）',
      link: '/development',
      readAt: null,
      createdAt: new Date(now()).toISOString(),
    },
    {
      id: '11',
      kind: 'reply',
      title: '同学回复了你的讨论',
      body: '请看讨论详情（本地模拟）',
      link: '/discussion?post=1',
      readAt: null,
      createdAt: new Date(now()).toISOString(),
    },
  ];
  let nextId = 2;
  const activeEvents = () => events.filter((item) => !item.deleted);
  function seriesState(publicId) {
    const selected = [...events, ...courseProjection(true).events].find(
      (item) => item.publicId === publicId && !item.deleted,
    );
    if (!selected) throw Object.assign(new Error('模拟日程不存在'), { status: 404 });
    if (!selected.seriesKey) return null;
    const imported = publicId.startsWith('cs_');
    const items = [...events, ...courseProjection(true).events].filter(
      (item) => item.seriesKey === selected.seriesKey,
    );
    const saved = seriesDefinitions.get(selected.seriesKey);
    const definition = saved?.definition || definitionFor(items, null, imported);
    const version = saved?.version || 0;
    const anchors = new Map(definition.occurrences.map((item) => [item.publicId, item]));
    const members = saved && !imported ? items.filter((item) => anchors.has(item.publicId)) : items;
    const normalized = members.map((item) => ({
      ...item,
      originalStartAt: anchors.get(item.publicId)?.startAt || item.originalStartAt || item.startAt,
      originalEndAt: anchors.get(item.publicId)?.endAt || item.originalEndAt || item.endAt,
    }));
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([version, definition, normalized]))
      .digest('hex');
    return {
      key: selected.seriesKey,
      imported,
      definition,
      version,
      fingerprint,
      items: normalized,
      selected: normalized.find((item) => item.publicId === publicId),
    };
  }
  let communityUnavailable = false;
  const result = (body, status = 200) => ({ body, status });

  async function handle({ route, url, method, body }) {
    const seriesMatch = /^\/api\/workbench\/schedule-items\/([^/]+)\/series$/.exec(route);
    if (seriesMatch) {
      try {
        const state = seriesState(decodeURIComponent(seriesMatch[1]));
        if (method === 'GET') return result({ series: summarizeSeries(state) });
        if (method !== 'POST' || !state) return result({ message: '模拟系列操作无效' }, 400);
        const plan = planMutation(state, body);
        const proposals = plan.generated || plan.patches || [];
        const ids = new Set(plan.affected.map((item) => item.publicId));
        if (
          body.operation === 'update' &&
          body.allowConflicts !== true &&
          proposals.some((item) =>
            [...activeEvents(), ...courseProjection().events].some(
              (other) =>
                !other.deleted &&
                !ids.has(other.publicId) &&
                other.kind !== 'deadline' &&
                overlaps(item, other),
            ),
          )
        )
          return result(
            { message: '修改后的安排与已有日程重叠，请核对后再次保存', code: 'course_conflict' },
            409,
          );
        plan.affected.forEach((item, index) => {
          if (item.deleted) return;
          const patch = plan.remove ? { deleted: true } : plan.patches[index];
          if (state.imported)
            personalEdits.set(item.publicId, {
              patch_json: {
                ...personalEdits.get(item.publicId)?.patch_json,
                ...patch,
                seriesManaged: body.scope !== 'single',
              },
              version: item.version + 1,
              updated_at: new Date(now()).toISOString(),
            });
          else
            Object.assign(
              events.find((entry) => entry.publicId === item.publicId),
              patch,
              { version: item.version + 1, exception: body.scope === 'single' || item.exception },
            );
        });
        const definition = { ...state.definition };
        if (plan.remove && body.scope === 'following') {
          definition.suppressedFrom =
            definition.suppressedFrom && definition.suppressedFrom < plan.anchor
              ? definition.suppressedFrom
              : plan.anchor;
          if (state.imported)
            personalEdits.set(`cs_series_${state.key.slice(7)}`, {
              patch_json: { suppressedFrom: definition.suppressedFrom },
            });
        }
        seriesDefinitions.set(state.key, { definition, version: state.version + 1 });
        if (plan.generated?.length) {
          nextId += 1;
          const key = `manual:${state.selected.kind === 'course' ? 'course' : 'recurring'}:preview${nextId}`;
          const generated = plan.generated.map((item) => {
            nextId += 1;
            return {
              ...item,
              publicId: `ws_preview_${nextId}`,
              sourceReference: key,
              seriesKey: key,
              sourceType: 'manual',
              kind: state.selected.kind,
              status: 'confirmed',
              version: 1,
            };
          });
          events.push(...generated);
          seriesDefinitions.set(key, {
            definition: {
              ...definitionFor(generated, plan.recurrence),
              externalExceptions: plan.exceptions || [],
            },
            version: 1,
          });
        }
        return result({ ok: true, created: plan.generated?.length || 0 });
      } catch (error) {
        return result({ message: error.message }, error.status || 500);
      }
    }
    if (route === '/api/workbench/schedule-planner/preferences') {
      try {
        if (method === 'PUT') {
          planningPreferences = normalizePreferences(body);
          preferencesSaved = true;
        }
        return result({ preferences: planningPreferences, saved: preferencesSaved });
      } catch (error) {
        return result({ message: error.message }, error.status || 500);
      }
    }
    if (route === '/api/workbench/schedule-planner/availability' && method === 'GET') {
      const days = Number(url.searchParams.get('days') || 1);
      if (![1, 7].includes(days)) return result({ message: '请选择今天或未来七天。' }, 400);
      const effective = planningPreferences.enabled
        ? planningPreferences
        : {
            ...planningPreferences,
            dayStart: '09:00',
            dayEnd: '21:00',
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            restWindows: [],
            breakMinutes: 0,
          };
      const windows = availableWindows(
        [...activeEvents(), ...courseProjection().events],
        new Date(now()),
        days,
        effective,
      );
      return result({
        windows,
        days,
        minutes: windows.reduce(
          (sum, gap) => sum + (Date.parse(gap.endAt) - Date.parse(gap.startAt)) / 60000,
          0,
        ),
      });
    }
    if (route === '/api/notifications') {
      if (communityUnavailable) return result({ message: '通知服务暂时不可用' }, 503);
      return result({
        notifications: communityNotices,
        unreadCount: communityNotices.filter((notice) => !notice.readAt).length,
        nextCursor: null,
      });
    }
    const readMatch = /^\/api\/notifications\/([^/]+)\/read$/.exec(route);
    if (readMatch && method === 'POST') {
      const notice = communityNotices.find((item) => item.id === readMatch[1]);
      if (!notice) return result({ message: '通知不存在' }, 404);
      notice.readAt = new Date(now()).toISOString();
      return result({ ok: true });
    }
    if (route === '/api/workbench/notifications') return result({ notifications: [] });
    if (route === '/api/workbench/campus/semesters') {
      return result({
        semesters: campusCourses.length
          ? [
              {
                id: semesterId,
                label: '模拟学期（仅本地）',
                synced: true,
                courseCount: campusCourses.length,
              },
            ]
          : [],
        currentSemesterId: campusCourses.length ? semesterId : null,
      });
    }
    if (route === `/api/workbench/campus/semesters/${semesterId}` && method === 'GET') {
      return result({
        semester: {
          id: semesterId,
          courses: campusCourses,
          notifications: campusNotices,
          fetchedAt: new Date(now()).toISOString(),
          syncStatus: 'complete',
        },
      });
    }
    if (route === '/api/workbench/campus/course-calendar') {
      const requested = method === 'GET' ? url.searchParams.get('semester') : body?.semesterId;
      if (requested !== semesterId || !campusCourses.length)
        return result({ message: '请先同步该学期课程。' }, 404);
      if (method === 'PUT') {
        if (!normalizeMonday(body.firstWeekMonday))
          return result({ message: '第一教学周必须是周一日期。' }, 400);
        if (Object.hasOwn(body, 'teachingWeeks')) {
          if (body.teachingWeeks !== null && !normalizeTeachingWeeks(body.teachingWeeks))
            return result({ message: '教学周数必须是 1–53 的整数。' }, 400);
          teachingWeeks = body.teachingWeeks;
        }
        firstWeekMonday = body.firstWeekMonday;
        // Fixture setup only; production calendars cannot be changed per account.
        savedCourses = structuredClone(campusCourses);
        copiedEvents = null;
        try {
          options = normalizeCalendarOptions(body.options || {}, firstWeekMonday);
        } catch (error) {
          return result({ message: error.message }, 400);
        }
      }
      if (method === 'GET' || method === 'PUT') return result(calendarStatus());
    }
    if (route === '/api/workbench/connectors/tsinghua/sync-runs' && method === 'POST')
      return result({ run: { publicId: 'preview-course-sync', status: 'succeeded' } });
    if (route === '/api/workbench/connectors/tsinghua/sync-runs/preview-course-sync')
      return result({ run: { publicId: 'preview-course-sync', status: 'succeeded' } });
    if (route === '/api/workbench/campus/course-import') {
      const projection = projectCourseSchedules(campusCourses, {
        semesterId,
        firstWeekMonday,
        teachingWeeks,
        options,
        includeExcluded: true,
      });
      const revision = require('node:crypto')
        .createHash('sha256')
        .update(JSON.stringify([campusCourses, savedCourses, importPending]))
        .digest('hex');
      if (method === 'POST') {
        if (body.revision !== revision) return result({ message: '请重新预览并确认。' }, 409);
        savedCourses = structuredClone(campusCourses);
        copiedEvents = structuredClone(projection);
        importPending = false;
        return result({ imported: true });
      }
      return result({
        semesterId,
        revision,
        firstWeekMonday,
        teachingWeeks,
        imported: !importPending,
        scheduledLessons: projection.events.filter((event) => !event.calendarHoliday).length,
        skippedLessons: projection.skippedLessons,
        issues: projection.issues,
        courses: campusCourses.map((course) => ({
          title: course.title,
          schedule: course.scheduleText,
          location: course.locationText,
        })),
      });
    }
    if (route === '/api/workbench/summary') {
      return result({
        importantItems,
        notifications: [],
        scheduleItems: [...activeEvents(), ...courseProjection().events],
      });
    }
    if (route === '/api/workbench/important-items') {
      if (method === 'GET') return result({ importantItems });
      if (method === 'POST') {
        nextId += 1;
        const item = {
          ...body,
          publicId: `wi_preview_${nextId}`,
          sourceType: 'manual',
          status: 'confirmed',
          version: 1,
        };
        importantItems.push(item);
        return result({ importantItem: item }, 201);
      }
    }
    const importantMatch = /^\/api\/workbench\/important-items\/([^/]+)$/.exec(route);
    if (importantMatch) {
      const index = importantItems.findIndex((item) => item.publicId === importantMatch[1]);
      if (index < 0) return result({ message: '模拟事项不存在' }, 404);
      if (method === 'DELETE') {
        importantItems.splice(index, 1);
        return result({ deleted: true });
      }
      if (method === 'PATCH') {
        importantItems[index] = {
          ...importantItems[index],
          ...body,
          version: importantItems[index].version + 1,
        };
        return result({ importantItem: importantItems[index] });
      }
    }
    if (
      ['/api/workbench/manual-courses', '/api/workbench/recurring-events'].includes(route) &&
      method === 'POST'
    ) {
      try {
        const kind = route.endsWith('/manual-courses') ? 'course' : body.kind;
        if (!['event', 'course'].includes(kind))
          return result({ message: '请选择事件或课程' }, 400);
        const items = expandManualCourse(body, { kind });
        if (activeEvents().some((item) => item.sourceReference === items[0].sourceReference)) {
          return result({ message: '这组课程已经添加' }, 409);
        }
        if (
          body.allowConflicts !== true &&
          items.some((item) =>
            [...activeEvents(), ...courseProjection().events].some(
              (other) => other.kind !== 'deadline' && overlaps(item, other),
            ),
          )
        ) {
          return result(
            { message: '重复课程与已有安排重叠，请核对后再次保存', code: 'course_conflict' },
            409,
          );
        }
        const generated = items.map((item) => {
          nextId += 1;
          return {
            ...item,
            seriesKey: item.sourceReference,
            publicId: `ws_preview_${nextId}`,
            status: 'confirmed',
            version: 1,
          };
        });
        events.push(...generated);
        seriesDefinitions.set(items[0].sourceReference, {
          definition: definitionFor(
            generated,
            body.recurrence || { unit: 'week', interval: body.intervalWeeks, count: body.count },
          ),
          version: 1,
        });
        return result({ created: items.length }, 201);
      } catch (error) {
        return result({ message: error.message }, error.status || 500);
      }
    }
    if (route === '/api/workbench/schedule-items') {
      if (method === 'GET') {
        const from = new Date(url.searchParams.get('from') || 0).getTime();
        const to = new Date(url.searchParams.get('to') || 0).getTime();
        return result({
          scheduleItems: [...activeEvents(), ...courseProjection().events].filter(
            (item) =>
              !item.deleted &&
              new Date(item.startAt).getTime() < to &&
              new Date(item.endAt).getTime() > from,
          ),
        });
      }
      if (method === 'POST') {
        nextId += 1;
        const item = {
          ...body,
          publicId: `ws_preview_${nextId}`,
          sourceType: 'manual',
          status: 'confirmed',
          kind: body.kind === 'deadline' ? 'deadline' : 'event',
          version: 1,
        };
        events.push(item);
        return result({ scheduleItem: item }, 201);
      }
    }
    if (route === '/api/workbench/schedule-items/conflicts') {
      const startAt = url.searchParams.get('startAt');
      const endAt = url.searchParams.get('endAt');
      const exclude = url.searchParams.get('excludePublicId');
      return result({
        conflicts: [...activeEvents(), ...courseProjection().events].filter(
          (item) =>
            !item.deleted &&
            item.publicId !== exclude &&
            item.kind !== 'deadline' &&
            overlaps({ startAt, endAt }, item),
        ),
      });
    }
    const scheduleMatch = /^\/api\/workbench\/schedule-items\/([^/]+)(?:\/(confirm))?$/.exec(route);
    if (scheduleMatch) {
      if (scheduleMatch[1].startsWith('cs_')) {
        const item = courseProjection().events.find((event) => event.publicId === scheduleMatch[1]);
        if (!item) return result({ message: '模拟课程不存在' }, 404);
        if (body.version !== item.version || body.sourceRevision !== item.sourceRevision)
          return result({ message: '课程已更新，请刷新' }, 409);
        try {
          const previousPatch = personalEdits.get(item.publicId)?.patch_json || {};
          const patch =
            method === 'DELETE'
              ? { ...previousPatch, deleted: true, seriesManaged: false }
              : { ...makePatch(item, body, previousPatch), seriesManaged: false };
          personalEdits.set(item.publicId, {
            patch_json: patch,
            version: item.version + 1,
            updated_at: new Date(now()).toISOString(),
          });
          return result(
            method === 'DELETE'
              ? { ok: true }
              : {
                  scheduleItem: courseProjection().events.find(
                    (event) => event.publicId === item.publicId,
                  ),
                },
          );
        } catch (error) {
          return result({ message: error.message }, error.status || 500);
        }
      }
      const index = events.findIndex((item) => item.publicId === scheduleMatch[1] && !item.deleted);
      if (index < 0) return result({ message: '模拟日程不存在' }, 404);
      if (method === 'DELETE') {
        Object.assign(events[index], {
          deleted: true,
          exception: true,
          version: events[index].version + 1,
        });
        return result({ deleted: true });
      }
      if (method === 'PATCH' || (method === 'POST' && scheduleMatch[2] === 'confirm')) {
        events[index] = {
          ...events[index],
          ...(method === 'PATCH' ? body : { status: 'confirmed' }),
          ...(method === 'PATCH' ? { exception: true } : {}),
          version: events[index].version + 1,
        };
        return result({ scheduleItem: events[index] });
      }
    }
    if (route === '/api/workbench/schedule-planner/preview' && method === 'POST') {
      try {
        const extraction = parseKnownScheduleMessage(body?.message, new Date(now()));
        if (!extraction) {
          return result(
            {
              message:
                '本地预览暂时无法完整解析这句话；请补充每件事的日期、时间和时长，或连接真实 AI 服务。',
            },
            422,
          );
        }
        return result(
          buildPreview(
            extraction,
            [...activeEvents(), ...courseProjection().events].filter(
              (item) => item.kind !== 'deadline',
            ),
            new Date(now()),
            planningPreferences,
          ),
        );
      } catch (error) {
        return result({ message: error.message }, error.status || 422);
      }
    }
    if (route === '/api/workbench/schedule-planner/confirm' && method === 'POST') {
      try {
        if (
          !Array.isArray(body.suggestions) ||
          body.suggestions.length < 1 ||
          body.suggestions.length > 52
        ) {
          return result({ message: '请选择 1–52 项计划再确认。' }, 400);
        }
        const suggestions = body.suggestions.map((item) =>
          validateSuggestion(item, new Date(now())),
        );
        const conflict = suggestions.some(
          (item, index) =>
            item.kind !== 'deadline' &&
            ([...activeEvents(), ...courseProjection().events].some(
              (busy) => busy.kind !== 'deadline' && overlaps(item, busy),
            ) ||
              suggestions
                .slice(index + 1)
                .some((other) => other.kind !== 'deadline' && overlaps(item, other))),
        );
        if (conflict) return result({ message: '与已有日程冲突，请重新生成。' }, 409);
        for (const item of suggestions) {
          nextId += 1;
          events.push({
            ...item,
            publicId: `ws_preview_${nextId}`,
            allDay: false,
            status: 'confirmed',
            sourceType: 'agent',
            version: 1,
          });
        }
        return result({ created: suggestions.length }, 201);
      } catch (error) {
        return result({ message: error.message }, error.status || 400);
      }
    }
    return null;
  }

  return {
    handle,
    events,
    importantItems,
    communityNotices,
    campusCourses,
    campusNotices,
    courseProjection,
    requireCourseConfirmation() {
      importPending = true;
      savedCourses = null;
      copiedEvents = null;
    },
    setCommunityUnavailable(value) {
      communityUnavailable = Boolean(value);
    },
  };
}

module.exports = { createWorkbenchPreviewApi };
