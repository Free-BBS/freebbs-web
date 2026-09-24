import { expect, test, type APIRequestContext } from '@playwright/test';

const apiRoot = '/api/development/v1';
const adminHeaders = {
  Authorization: 'Bearer production-admin-token',
  'Content-Type': 'application/json',
};
const studentHeaders = { Authorization: 'Bearer production-student-token' };
const roleKey = 'department.arts_member';

interface PermissionBinding {
  action: string;
  resource: string;
  effect: 'allow' | 'deny';
  scope: { type: string; id: string };
}

async function expectOk(response: Awaited<ReturnType<APIRequestContext['get']>>) {
  expect(response.ok(), await response.text()).toBe(true);
  return response;
}

// eslint-disable-next-line no-empty-pattern -- an empty fixture list lets skip run before browser launch.
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'production-shape',
    'Production governance requires MySQL and the main-site authentication contract.',
  );
});

test('the production administrator exercises every governance section against MySQL', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  page.on('dialog', (dialog) => dialog.accept());

  await expectOk(await request.get(`${apiRoot}/me`, { headers: studentHeaders }));
  const rolePermissionsResponse = await expectOk(
    await request.get(`${apiRoot}/admin/role-permissions`, { headers: adminHeaders }),
  );
  const rolePermissions = (await rolePermissionsResponse.json()) as {
    data: Array<PermissionBinding & { roleKey: string; status: string }>;
  };
  const originalRoleBindings = rolePermissions.data
    .filter((binding) => binding.roleKey === roleKey && binding.status === 'active')
    .map(({ action, resource, effect, scope }) => ({ action, resource, effect, scope }));

  const ownersResponse = await expectOk(
    await request.get(`${apiRoot}/admin/modules/liaison/owners`, { headers: adminHeaders }),
  );
  const owners = (await ownersResponse.json()) as {
    data: {
      owners: Array<{ ownerType: 'role' | 'subject' | 'team'; ownerId: string; status: string }>;
    };
  };
  const originalOwners = owners.data.owners
    .filter(({ status }) => status === 'active')
    .map(({ ownerType, ownerId }) => ({ ownerType, ownerId }));

  let roleAssignmentId = '';
  const tagKey = `extension.release_gate_${Date.now()}`;
  try {
    const roleGrant = await request.post(`${apiRoot}/admin/role-assignments`, {
      headers: adminHeaders,
      data: {
        subjectUid: 'main-site-student',
        roleKey,
        scope: { type: 'public', id: '*' },
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
    });
    expect(roleGrant.status(), await roleGrant.text()).toBe(201);
    roleAssignmentId = ((await roleGrant.json()) as { data: { id: string } }).data.id;

    const replacedRolePermissions = await request.put(
      `${apiRoot}/admin/roles/${roleKey}/permissions`,
      {
        headers: adminHeaders,
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
      },
    );
    await expectOk(replacedRolePermissions);

    const createdTag = await request.post(`${apiRoot}/admin/tag-definitions`, {
      headers: adminHeaders,
      data: {
        key: tagKey,
        name: '发布门禁扩展 Tag',
        description: '由 production-shape E2E 验证的扩展权限接口。',
        requiredScopeType: null,
        metadata: { resourceTypes: [] },
      },
    });
    expect(createdTag.status(), await createdTag.text()).toBe(201);

    await expectOk(
      await request.put(`${apiRoot}/admin/modules/liaison/owners`, {
        headers: adminHeaders,
        data: { owners: [{ ownerType: 'subject', ownerId: 'main-site-student' }] },
      }),
    );

    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key, token),
      ['free_bbs_auth_token', 'production-admin-token'],
    );
    await page.goto('./admin');
    await expect(
      page.getByRole('main', { name: '治理管理台' }).locator(':scope > header'),
    ).toHaveClass(/module-page-header/);
    await expect(page.getByRole('search')).toHaveClass(/filter-bar/);
    await expect(page.getByRole('list').first()).toHaveClass(/responsive-record-list/);

    const sections = [
      '用户与授权',
      '角色与权限',
      'Tag 定义',
      '模块与负责人',
      '业务数据入口',
      '审计日志',
      '系统状态',
    ];
    for (const section of sections) {
      await page.getByRole('tab', { name: section }).click();
      await expect(page.getByRole('tabpanel', { name: section })).toBeVisible();
    }

    await page.getByRole('tab', { name: '业务数据入口' }).click();
    await expect(page.getByRole('link', { name: '进入知识库' })).toHaveAttribute(
      'href',
      '/development/knowledge',
    );

    await page.getByRole('tab', { name: '审计日志' }).click();
    const auditFilters = page.getByRole('form', { name: '审计筛选' });
    await auditFilters.getByLabel('操作人 UID').fill('demo-admin');
    await auditFilters.getByLabel('动作').fill('admin.module_owners.replace');
    await auditFilters.getByLabel('资源 ID').fill('liaison');
    await auditFilters.getByRole('button', { name: '筛选日志' }).click();
    await expect(page.locator('.audit-list')).toContainText('admin.module_owners.replace');

    await page.getByRole('tab', { name: '系统状态' }).click();
    const statusPanel = page.getByRole('tabpanel', { name: '系统状态' });
    await expect(statusPanel).toContainText('mysql');
    await expect(
      statusPanel.getByText('已应用迁移', { exact: true }).locator('..').locator('dd'),
    ).toHaveText(/^[1-9]\d*$/);
  } finally {
    await expectOk(
      await request.put(`${apiRoot}/admin/roles/${roleKey}/permissions`, {
        headers: adminHeaders,
        data: { bindings: originalRoleBindings },
      }),
    );
    await expectOk(
      await request.put(`${apiRoot}/admin/modules/liaison/owners`, {
        headers: adminHeaders,
        data: { owners: originalOwners },
      }),
    );
    if (roleAssignmentId) {
      await expectOk(
        await request.delete(`${apiRoot}/admin/role-assignments/${roleAssignmentId}`, {
          headers: adminHeaders,
        }),
      );
    }
  }
});
