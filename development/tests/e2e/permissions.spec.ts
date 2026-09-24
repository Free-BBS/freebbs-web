import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiRoot = '/api/development/v1';

function demoHeaders(user: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Demo-User': user };
}

async function setModule(request: APIRequestContext, moduleId: string, enabled: boolean) {
  const response = await request.patch(`${apiRoot}/admin/modules`, {
    headers: demoHeaders('demo-admin'),
    data: { moduleId, enabled },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function openAdmin(page: Page) {
  await page.goto('./dashboard');
  await expect(page.getByLabel('Demo user')).toHaveValue('demo-student');
  await page.getByLabel('Demo user').selectOption('demo-admin');
  await expect(page.getByLabel('Demo user')).toHaveValue('demo-admin');
  await page.locator('.sidebar .module-nav a[href="/development/admin"]').click();
  await expect(page).toHaveURL(/\/development\/admin$/);
}

test('ordinary students cannot see governed modules and are redirected from administration', async ({
  page,
}) => {
  await page.goto('./dashboard');
  await expect(page.getByLabel('Demo user')).toHaveValue('demo-student');
  await expect(page.locator('.sidebar a[href="/development/finance"]')).toHaveCount(0);
  await expect(page.locator('.sidebar a[href="/development/admin"]')).toHaveCount(0);

  await page.goto('./admin');
  await expect(page).toHaveURL(/\/development\/dashboard$/);
  await expect(page.getByRole('heading', { name: '发展端工作台' })).toBeVisible();
});

test('a captain can check in their own team but is denied across teams', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  await page.goto('./sports');
  await expect(page.getByLabel('Demo user')).toHaveValue('demo-student');
  await page.getByLabel('Demo user').selectOption('demo-captain');
  await expect(page.getByLabel('Demo user')).toHaveValue('demo-captain');

  const ownTeam = page.getByRole('article', { name: '院篮球队' });
  const otherTeam = page.getByRole('article', { name: '院羽毛球队' });
  await expect(otherTeam.getByRole('form')).toHaveCount(0);
  await ownTeam.getByRole('link', { name: '查看队伍详情' }).click();
  await expect(page).toHaveURL(/\/development\/sports\/team-basketball$/);

  const checkinForm = page.getByRole('form', { name: '训练签到' });
  await expect(checkinForm).toBeVisible();
  await checkinForm.getByLabel('成员 UID').fill('demo-captain');
  await checkinForm.getByLabel('签到日期').fill('2026-07-22');
  await checkinForm.getByRole('button', { name: '记录签到' }).click();
  await expect(page.getByRole('status')).toHaveText('签到已记录');

  const denied = await request.post(`${apiRoot}/sports/teams/team-badminton/checkins`, {
    headers: demoHeaders('demo-captain'),
    data: { memberUid: 'e2e-cross-team', checkinDate: '2026-07-22' },
  });
  expect(denied.status()).toBe(404);
  await expect(denied.json()).resolves.toMatchObject({
    data: { error: { code: 'sports_team_not_found' } },
  });
});

test('the administrator can grant and revoke a role with visible audit history', async ({
  page,
  request,
}) => {
  page.on('dialog', (dialog) => dialog.accept());
  const existingResponse = await request.get(`${apiRoot}/admin/role-assignments`, {
    headers: demoHeaders('demo-admin'),
  });
  const existing = (await existingResponse.json()) as {
    data: { items: Array<{ id: string; subjectUid: string; roleKey: string }> };
  };
  for (const assignment of existing.data.items.filter(
    (item) => item.subjectUid === 'demo-student' && item.roleKey === 'department.arts_member',
  )) {
    await request.delete(`${apiRoot}/admin/role-assignments/${assignment.id}`, {
      headers: demoHeaders('demo-admin'),
    });
  }

  await openAdmin(page);
  const panel = page.getByRole('tabpanel', { name: '用户与授权' });
  const grant = panel.getByRole('form', { name: '授予角色' });
  await grant.getByLabel('用户 UID').fill('demo-student');
  await grant.getByLabel('角色').selectOption('department.arts_member');
  await grant.getByRole('button', { name: '授予角色' }).click();
  await expect(page.getByText('已向 demo-student 授予 department.arts_member。')).toBeVisible();

  const afterGrant = await request.get(`${apiRoot}/admin/role-assignments`, {
    headers: demoHeaders('demo-admin'),
  });
  const granted = (await afterGrant.json()) as {
    data: { items: Array<{ id: string; subjectUid: string; roleKey: string }> };
  };
  const assignment = granted.data.items.find(
    (item) => item.subjectUid === 'demo-student' && item.roleKey === 'department.arts_member',
  );
  expect(assignment).toBeTruthy();
  await panel.getByRole('button', { name: '归档 demo-student 的角色授权' }).click();
  await expect(
    page.getByText('已归档 demo-student 的 department.arts_member 授权。'),
  ).toBeVisible();

  await page.getByRole('tab', { name: '审计日志' }).click();
  const filters = page.getByRole('form', { name: '审计筛选' });
  await filters.getByLabel('操作人 UID').fill('demo-admin');
  await filters.getByLabel('动作').fill('admin.role_assignment.revoke');
  await filters.getByLabel('资源 ID').fill(assignment!.id);
  await filters.getByRole('button', { name: '筛选日志' }).click();
  await expect(page.locator('.audit-list')).toContainText('admin.role_assignment.revoke');
});

test('module disabling removes navigation and rejects the module API', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  page.on('dialog', (dialog) => dialog.accept());
  await setModule(request, 'liaison', true);
  try {
    await openAdmin(page);
    await page.getByRole('tab', { name: '模块与负责人' }).click();
    await page.locator('.admin-definition-list button').filter({ hasText: 'liaison' }).click();
    await page.getByRole('button', { name: '停用 無限机会' }).click();
    await expect(page.getByText('模块 liaison 已停用。')).toBeVisible();

    await page.goto('./dashboard');
    await expect(page.locator('.sidebar a[href="/development/liaison"]')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-module-card')).toHaveCount(0);

    const disabledResponse = await request.get(`${apiRoot}/liaison/resources`, {
      headers: demoHeaders('demo-admin'),
    });
    expect(disabledResponse.status()).toBe(503);
    await expect(disabledResponse.json()).resolves.toMatchObject({
      data: { error: { code: 'module_disabled' } },
    });
  } finally {
    await setModule(request, 'liaison', true);
  }
});
test('governs subjects, expiring grants, binding replacement and audit filters', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  page.on('dialog', (dialog) => dialog.accept());
  const expiry = '2030-01-01T00:00:00.000Z';
  const roleKey = 'department.arts_member';
  const rolePermissionsResponse = await request.get(`${apiRoot}/admin/role-permissions`, {
    headers: demoHeaders('demo-admin'),
  });
  expect(rolePermissionsResponse.status()).toBe(200);
  const rolePermissions = (await rolePermissionsResponse.json()) as {
    data: Array<{
      roleKey: string;
      action: string;
      resource: string;
      effect: 'allow' | 'deny';
      scope: { type: string; id: string };
      status: string;
    }>;
  };
  const originalBindings = rolePermissions.data
    .filter((binding) => binding.roleKey === roleKey && binding.status === 'active')
    .map(({ action, resource, effect, scope }) => ({ action, resource, effect, scope }));

  let roleAssignmentId = '';
  let tagAssignmentId = '';
  try {
    const roleGrant = await request.post(`${apiRoot}/admin/role-assignments`, {
      headers: demoHeaders('demo-admin'),
      data: {
        subjectUid: 'demo-student',
        roleKey,
        scope: { type: 'public', id: '*' },
        expiresAt: expiry,
      },
    });
    expect(roleGrant.status(), await roleGrant.text()).toBe(201);
    const roleGrantBody = (await roleGrant.json()) as {
      data: { id: string; expiresAt: string };
    };
    roleAssignmentId = roleGrantBody.data.id;
    expect(roleGrantBody.data.expiresAt).toBe(expiry);

    const tagGrant = await request.post(`${apiRoot}/admin/tag-assignments`, {
      headers: demoHeaders('demo-admin'),
      data: {
        subjectUid: 'demo-student',
        tagKey: 'sports.team_captain',
        scope: { type: 'sports_team', id: 'team-basketball' },
        expiresAt: expiry,
      },
    });
    expect(tagGrant.status(), await tagGrant.text()).toBe(201);
    const tagGrantBody = (await tagGrant.json()) as {
      data: { id: string; expiresAt: string };
    };
    tagAssignmentId = tagGrantBody.data.id;
    expect(tagGrantBody.data.expiresAt).toBe(expiry);

    const replaced = await request.put(`${apiRoot}/admin/roles/${roleKey}/permissions`, {
      headers: demoHeaders('demo-admin'),
      data: {
        bindings: [
          {
            action: 'knowledge.read',
            resource: 'knowledge_entry',
            effect: 'allow',
            scope: { type: 'public', id: '*' },
          },
        ],
      },
    });
    expect(replaced.status(), await replaced.text()).toBe(200);
    await expect(replaced.json()).resolves.toMatchObject({
      data: {
        roleKey,
        bindings: [
          {
            action: 'knowledge.read',
            resource: 'knowledge_entry',
            effect: 'allow',
            scope: { type: 'public', id: '*' },
          },
        ],
      },
    });

    await openAdmin(page);
    const directory = page.getByRole('tabpanel', { name: '用户与授权' });
    await expect(directory).toContainText('共 16 位用户');
    await directory.getByLabel('搜索用户').fill('demo-student');
    await directory.getByRole('button', { name: '筛选用户' }).click();
    await expect(directory).toContainText('共 1 位用户');
    await expect(
      directory
        .getByRole('region', { name: '用户目录' })
        .locator('.record-card')
        .filter({ hasText: 'demo-student' }),
    ).toBeVisible();
    await expect(directory).toContainText(expiry.slice(0, 10));

    await page.getByRole('tab', { name: '审计日志' }).click();
    const filters = page.getByRole('form', { name: '审计筛选' });
    await filters.getByLabel('操作人 UID').fill('demo-admin');
    await filters.getByLabel('动作').fill('admin.role_permissions.replace');
    await filters.getByLabel('资源类型').fill('role');
    await filters.getByLabel('资源 ID').fill(roleKey);
    await filters.getByRole('button', { name: '筛选日志' }).click();
    const auditRows = page.locator('.audit-list .record-card');
    await expect(auditRows.first()).toContainText('admin.role_permissions.replace');
    await expect(auditRows.first()).toContainText(`demo-admin · role/${roleKey}`);
  } finally {
    const restore = await request.put(`${apiRoot}/admin/roles/${roleKey}/permissions`, {
      headers: demoHeaders('demo-admin'),
      data: { bindings: originalBindings },
    });
    expect(restore.status(), await restore.text()).toBe(200);
    if (roleAssignmentId) {
      const archived = await request.delete(
        `${apiRoot}/admin/role-assignments/${roleAssignmentId}`,
        { headers: demoHeaders('demo-admin') },
      );
      expect(archived.status()).toBe(200);
    }
    if (tagAssignmentId) {
      const archived = await request.delete(`${apiRoot}/admin/tag-assignments/${tagAssignmentId}`, {
        headers: demoHeaders('demo-admin'),
      });
      expect(archived.status()).toBe(200);
    }
  }
});
