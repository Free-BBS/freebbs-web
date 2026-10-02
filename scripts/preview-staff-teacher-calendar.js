// Independent loopback preview. Only demonstration accounts and temporary memory data.
const { createScheduleSeriesPreview } = require('./preview-schedule-series');
const {
  createTeacherAccountsPreviewApi,
  DEMO_PASSWORD,
  DEMO_CODE,
} = require('./preview-teacher-accounts');

async function createStaffTeacherCalendarPreview() {
  const teacher = createTeacherAccountsPreviewApi();
  const preview = await createScheduleSeriesPreview({
    extraApi: teacher.handle,
    allowDemoAuthentication: true,
    extraPages: {
      '/adminusers': 'adminusers.html',
      '/login': 'login.html',
      '/remake': 'remake.html',
    },
    transformHtml(html) {
      const accountScript = `<script>
        const demoAccount = new URLSearchParams(location.search).get('demo');
        if (demoAccount === 'teacher' || demoAccount === 'admin') {
          document.cookie = 'freebbs_demo_account=' + (demoAccount === 'teacher' ? '2' : '1') + ';Path=/;SameSite=Strict';
          localStorage.removeItem('free_bbs_user');
        }
      </script>`;
      const links = `<p><a href="/staff">工作人员</a> · <a href="/adminusers?demo=admin">演示管理员</a> · <a href="/settings?demo=teacher">演示教师</a> · <a href="/workbench">日程</a> · <a href="/guide">简短导引</a></p>
        <p>演示密码：${DEMO_PASSWORD}；邮箱验证码：${DEMO_CODE}。仅在此预览使用，不会发邮件。</p>`;
      return html
        .replace('</head>', `${accountScript}</head>`)
        .replace(
          /<details data-preview-notice[\s\S]*?<\/details>/,
          `<aside data-preview-notice style="margin:12px;padding:12px;border-radius:12px;background:#133c45;color:white;font:14px/1.6 system-ui"><strong>工作人员、教师账号与日程 · 独立本地预览</strong><p>账号、验证码、课程和日程均为演示数据，重启清空。此页面未连接线上服务。</p>${links}</aside>`,
        );
    },
  });
  return { ...preview, teacher };
}

if (require.main === module) {
  createStaffTeacherCalendarPreview()
    .then(({ server }) => {
      server.listen(
        Number(process.env.STAFF_TEACHER_CALENDAR_PREVIEW_PORT || 3156),
        '127.0.0.1',
        () => {
          console.log(`Independent preview: http://127.0.0.1:${server.address().port}/staff`);
          console.log(
            `Demo teacher/admin password: ${DEMO_PASSWORD}; demo email code: ${DEMO_CODE}`,
          );
        },
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { createStaffTeacherCalendarPreview };
