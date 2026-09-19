const {
  buildPreview,
  overlaps,
  parseKnownScheduleMessage,
  validateSuggestion,
} = require('../backend/workbench-schedule-planner');

function createWorkbenchPreviewApi({ now = Date.now } = {}) {
  const events = [{
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
  }];
  const importantItems = [{
    publicId: 'wi_preview_1',
    title: '查看本周计划',
    description: '这是一条本地模拟事项，可编辑或删除。',
    dueAt: new Date(now() + 24 * 3600000).toISOString(),
    priority: 'normal',
    status: 'confirmed',
    sourceType: 'manual',
    version: 1,
  }];
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
  let communityUnavailable = false;
  const result = (body, status = 200) => ({ body, status });

  async function handle({ route, url, method, body }) {
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
      return result({ semesters: [], currentSemesterId: null });
    }
    if (route === '/api/workbench/summary') {
      return result({ importantItems, notifications: [], scheduleItems: events });
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
        importantItems[index] = { ...importantItems[index], ...body, version: importantItems[index].version + 1 };
        return result({ importantItem: importantItems[index] });
      }
    }
    if (route === '/api/workbench/schedule-items') {
      if (method === 'GET') {
        const from = new Date(url.searchParams.get('from') || 0).getTime();
        const to = new Date(url.searchParams.get('to') || 0).getTime();
        return result({ scheduleItems: events.filter((item) => new Date(item.startAt).getTime() < to && new Date(item.endAt).getTime() > from) });
      }
      if (method === 'POST') {
        nextId += 1;
        const item = {
          ...body,
          publicId: `ws_preview_${nextId}`,
          sourceType: 'manual',
          status: 'confirmed',
          kind: 'event',
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
      return result({ conflicts: events.filter((item) => item.publicId !== exclude && item.kind !== 'deadline' && overlaps({ startAt, endAt }, item)) });
    }
    const scheduleMatch = /^\/api\/workbench\/schedule-items\/([^/]+)(?:\/(confirm))?$/.exec(route);
    if (scheduleMatch) {
      const index = events.findIndex((item) => item.publicId === scheduleMatch[1]);
      if (index < 0) return result({ message: '模拟日程不存在' }, 404);
      if (method === 'DELETE') {
        events.splice(index, 1);
        return result({ deleted: true });
      }
      if (method === 'PATCH' || (method === 'POST' && scheduleMatch[2] === 'confirm')) {
        events[index] = {
          ...events[index],
          ...(method === 'PATCH' ? body : { status: 'confirmed' }),
          version: events[index].version + 1,
        };
        return result({ scheduleItem: events[index] });
      }
    }
    if (route === '/api/workbench/schedule-planner/preview' && method === 'POST') {
      const extraction = parseKnownScheduleMessage(body?.message, new Date(now()));
      if (!extraction) {
        return result({ message: '本地预览暂时无法解析这句话；请补充日期、时间和时长，或连接真实 AI 服务。' }, 422);
      }
      try {
        return result(buildPreview(extraction, events.filter((item) => item.kind !== 'deadline'), new Date(now())));
      } catch (error) {
        return result({ message: error.message }, error.status || 422);
      }
    }
    if (route === '/api/workbench/schedule-planner/confirm' && method === 'POST') {
      try {
        if (!Array.isArray(body.suggestions) || body.suggestions.length < 1 || body.suggestions.length > 52) {
          return result({ message: '请选择 1–52 项计划再确认。' }, 400);
        }
        const suggestions = body.suggestions.map((item) => validateSuggestion(item, new Date(now())));
        const conflict = suggestions.some((item, index) => item.kind !== 'deadline' && (
          events.some((busy) => busy.kind !== 'deadline' && overlaps(item, busy)) ||
          suggestions.slice(index + 1).some((other) => other.kind !== 'deadline' && overlaps(item, other))
        ));
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
    setCommunityUnavailable(value) { communityUnavailable = Boolean(value); },
  };
}

module.exports = { createWorkbenchPreviewApi };
