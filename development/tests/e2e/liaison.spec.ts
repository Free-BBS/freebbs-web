import { expect, test, type Page } from '@playwright/test';

const apiRoot = '/api/development/v1';
const headers = (user: string) => ({
  'Content-Type': 'application/json',
  'X-Demo-User': user,
});

async function switchUser(page: Page, user: string) {
  await page.getByLabel('Demo user').selectOption(user);
  await expect(page.getByLabel('Demo user')).toHaveValue(user);
  await expect(page.getByRole('link', { name: '打开我的个人主页' })).toHaveAttribute(
    'href',
    new RegExp(`uid=${user}$`),
  );
}

test('liaison member can submit a new opportunity and an administrator can publish it', async ({
  page,
}) => {
  const title = `委托发布验证-${Date.now()}`;

  await page.goto('./liaison');
  await switchUser(page, 'demo-liaison-member');
  await page.getByRole('button', { name: '查看委托' }).click();
  await page.getByRole('button', { name: '新增委托' }).click();

  const create = page.getByRole('dialog', { name: '代录真实问题' });
  await create.getByLabel('问题标题').fill(title);
  await create.getByLabel('简短摘要').fill('验证一条新委托可以进入完整的发布审核流程。');
  await create.getByLabel('背景说明').fill('由联络中心整理并代录的真实合作需求。');
  await create.getByLabel('来源类型').selectOption('company');
  await create.getByLabel('来源名称').fill('测试合作伙伴');
  await create.getByLabel('领域标签（用逗号分隔）').fill('校园合作,产品设计');
  await create.getByLabel('预期成果').fill('一份可以交付的验证原型。');
  await create.getByLabel('限制条件').fill('仅使用公开或匿名化数据。');
  await create.getByLabel('公开对接方式').fill('联络中心公开咨询台');
  await create.getByLabel('内部对接说明').fill('仅授权维护人员查看');
  await create.getByRole('button', { name: '保存课题草稿' }).click();
  await expect(page.getByRole('status')).toHaveText('问题草稿已保存');

  const card = page.getByRole('article', { name: title, exact: true });
  await card.getByRole('button', { name: `展开${title}`, exact: true }).click();
  await page
    .getByRole('region', { name: `${title}委托详情`, exact: true })
    .getByRole('link', { name: '查看完整委托' })
    .click();
  await page.getByRole('button', { name: '提交审核' }).click();
  await expect(page.getByText('待审核', { exact: true })).toBeVisible();

  await switchUser(page, 'demo-admin');
  await page.getByRole('button', { name: '批准发布' }).click();
  await expect(page.getByText('进行中', { exact: true })).toBeVisible();
});

test('liaison supports proxy entry, explicit review and a student problem community', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const suffix = `${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
  const title = `E2E 校企真实问题 ${suffix}`;
  const editedTitle = `${title} 已校对`;
  const teamName = `E2E 探索队 ${suffix}`;
  const existingTeamName = `E2E 现有团队 ${suffix}-${Date.now()}`;

  const existingTeamResponse = await request.post(
    `${apiRoot}/liaison/problems/liaison-problem-lab-energy/teams`,
    {
      headers: headers('demo-student'),
      data: { name: existingTeamName, proposal: '验证已有团队的申请与确认闭环。' },
    },
  );
  expect(existingTeamResponse.status(), await existingTeamResponse.text()).toBe(201);
  const existingTeamId = ((await existingTeamResponse.json()) as { data: { id: string } }).data.id;

  await page.goto('./liaison/problems/liaison-problem-lab-energy');
  await switchUser(page, 'demo-captain');
  const existingTeam = page.locator('.liaison-team-list > li').filter({
    hasText: existingTeamName,
  });
  await existingTeam.getByRole('button', { name: '申请加入' }).click();
  await expect(existingTeam.getByText('申请待确认')).toBeVisible();
  await expect(existingTeam.getByRole('button', { name: '申请加入' })).toHaveCount(0);

  await page.reload();
  await switchUser(page, 'demo-captain');
  await expect(
    page
      .locator('.liaison-team-list > li')
      .filter({ hasText: existingTeamName })
      .getByText('申请待确认'),
  ).toBeVisible();
  await switchUser(page, 'demo-student');
  await page
    .locator('.liaison-team-list > li')
    .filter({ hasText: existingTeamName })
    .getByRole('button', { name: '确认 demo-captain 加入' })
    .click();
  await expect(page.getByRole('status')).toHaveText('已确认 demo-captain 加入');
  await switchUser(page, 'demo-captain');
  await expect(
    page
      .locator('.liaison-team-list > li')
      .filter({ hasText: existingTeamName })
      .getByText('已加入团队'),
  ).toBeVisible();

  const confirmedMembership = await request.get(
    `${apiRoot}/liaison/problems/liaison-problem-lab-energy/teams`,
    { headers: headers('demo-captain') },
  );
  expect(confirmedMembership.status(), await confirmedMembership.text()).toBe(200);
  const confirmedTeams = (await confirmedMembership.json()) as {
    data: Array<{ id: string; members: Array<{ memberUid: string; status: string }> }>;
  };
  expect(
    confirmedTeams.data
      .find(({ id }) => id === existingTeamId)
      ?.members.find(({ memberUid }) => memberUid === 'demo-captain'),
  ).toMatchObject({ status: 'active' });

  await page.goto('./liaison');
  await expect(page.getByRole('heading', { name: '無限机会' })).toBeVisible();
  await page.getByRole('button', { name: '查看委托' }).click();
  await expect(page.getByRole('button', { name: '新增委托' })).toHaveCount(0);

  await switchUser(page, 'demo-liaison-member');
  await page.getByRole('button', { name: '查看委托' }).click();
  await page.getByRole('button', { name: '新增委托' }).click();
  const create = page.getByRole('dialog', { name: '代录真实问题' });
  await create.getByLabel('问题标题').fill(title);
  await create.getByLabel('简短摘要').fill('把真实业务问题整理为可协作的学生课题。');
  await create.getByLabel('背景说明').fill('合作方希望验证一个轻量原型。');
  await create.getByLabel('来源类型').selectOption('company');
  await create.getByLabel('来源名称').fill('E2E 校企合作伙伴');
  await create.getByLabel('领域标签（用逗号分隔）').fill('产品设计,前端');
  await create.getByLabel('预期成果').fill('可运行原型与简短复盘。');
  await create.getByLabel('限制条件').fill('只能使用公开或匿名化数据。');
  await create.getByLabel('公开对接方式').fill('联络中心公开咨询台');
  await create.getByLabel('内部对接说明').fill('private-contact-e2e');
  await create.getByRole('button', { name: '保存课题草稿' }).click();
  await expect(page.getByRole('status')).toHaveText('问题草稿已保存');

  const card = page.locator('.liaison-problem-card').filter({ hasText: title });
  await expect(card).toContainText('企业 · E2E 校企合作伙伴');
  await card.getByRole('button', { name: `展开${title}` }).click();
  await page
    .getByRole('region', { name: `${title}委托详情` })
    .getByRole('link', { name: '查看完整委托' })
    .click();
  await page.getByRole('button', { name: '编辑课题' }).click();
  const editor = page.getByRole('dialog', { name: '编辑课题' });
  await editor.getByLabel('问题标题').fill(editedTitle);
  await editor.getByRole('button', { name: '保存课题修改' }).click();
  await expect(page.getByRole('heading', { name: editedTitle })).toBeVisible();
  await page.getByRole('button', { name: '提交审核' }).click();
  await expect(page.getByText('待审核', { exact: true })).toBeVisible();

  await switchUser(page, 'demo-admin');
  await expect(page.getByRole('button', { name: '批准发布' })).toBeVisible();
  await page.getByRole('button', { name: '批准发布' }).click();
  await expect(page.getByText('进行中', { exact: true })).toBeVisible();

  await switchUser(page, 'demo-student');
  await expect(page.getByRole('button', { name: '编辑课题' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '批准发布' })).toHaveCount(0);
  await expect(page.getByText('private-contact-e2e')).toHaveCount(0);
  await page.getByRole('button', { name: '参与课题' }).click();
  const join = page.getByRole('dialog', { name: '参与课题' });
  await join.getByLabel('团队名称').fill(teamName);
  await join.getByLabel('简短方案').fill('先访谈确认目标，再完成一个可测试原型。');
  await join.getByRole('button', { name: '创建并参与团队' }).click();
  await expect(
    page.getByRole('list', { name: '参与课题的团队' }).getByText(teamName),
  ).toBeVisible();

  await page.getByLabel('讨论内容').fill('我们先确认公开样例数据的边界。');
  await page.getByRole('button', { name: '发布讨论' }).click();
  await expect(page.getByText('我们先确认公开样例数据的边界。')).toBeVisible();

  const list = await request.get(
    `${apiRoot}/liaison/problems?query=${encodeURIComponent(editedTitle)}`,
    {
      headers: headers('demo-student'),
    },
  );
  expect(list.status(), await list.text()).toBe(200);
  const body = (await list.json()) as { data: { items: Array<Record<string, unknown>> } };
  const created = body.data.items.find((item) => item.title === editedTitle);
  expect(created).toBeTruthy();
  expect(created).not.toHaveProperty('internalContactNote');
  expect(JSON.stringify(created)).not.toContain('private-contact-e2e');
});
