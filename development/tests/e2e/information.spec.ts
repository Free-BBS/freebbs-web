import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiRoot = '/api/development/v1';
const headers = (user: string) => ({
  'Content-Type': 'application/json',
  'X-Demo-User': user,
});

async function switchUser(page: Page, user: string) {
  await page.getByLabel('Demo user').selectOption(user);
  await expect(page.getByLabel('Demo user')).toHaveValue(user);
}

async function transition(
  request: APIRequestContext,
  kind: 'announcements' | 'consultations',
  id: string,
  to: string,
) {
  const response = await request.post(`${apiRoot}/information/${kind}/${id}/transitions`, {
    headers: headers('demo-admin'),
    data: { to },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test('information covers consultation and announcement lifecycles end to end', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const suffix = `${testInfo.workerIndex}-${testInfo.retry}`;
  const consultationTitle = `E2E 咨询 ${suffix}`;
  const editedConsultationTitle = `${consultationTitle} 已编辑`;
  const announcementTitle = `E2E 公告 ${suffix}`;
  const editedAnnouncementTitle = `${announcementTitle} 已编辑`;
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('./information/consultations');
  await page.getByLabel('咨询标题').fill(consultationTitle);
  await page.getByLabel('咨询内容').fill('普通同学通过真实界面提交咨询。');
  await page.getByRole('button', { name: '提交咨询' }).click();
  await expect(page.getByRole('status')).toHaveText('咨询已提交');
  const consultationCard = page.locator('.record-card').filter({ hasText: consultationTitle });
  await consultationCard.getByRole('button', { name: `编辑 ${consultationTitle}` }).click();
  await consultationCard.getByLabel('编辑咨询标题').fill(editedConsultationTitle);
  await consultationCard.getByLabel('编辑咨询内容').fill('编辑后的咨询正文。');
  await consultationCard.getByRole('button', { name: '保存咨询修改' }).click();
  await expect(page.getByRole('status')).toHaveText('咨询修改已保存');

  const ownResponse = await request.get(`${apiRoot}/information/consultations`, {
    headers: headers('demo-student'),
  });
  const own = (await ownResponse.json()) as { data: Array<{ id: string; title: string }> };
  const consultation = own.data.find((item) => item.title === editedConsultationTitle);
  expect(consultation).toBeTruthy();

  const illegalConsultation = await request.post(
    `${apiRoot}/information/consultations/${consultation!.id}/transitions`,
    { headers: headers('demo-admin'), data: { to: 'resolved' } },
  );
  expect(illegalConsultation.status()).toBe(409);
  await transition(request, 'consultations', consultation!.id, 'in_progress');
  await transition(request, 'consultations', consultation!.id, 'resolved');
  await transition(request, 'consultations', consultation!.id, 'in_progress');
  await transition(request, 'consultations', consultation!.id, 'resolved');
  await transition(request, 'consultations', consultation!.id, 'closed');

  await page.goto('./information/announcements');
  await switchUser(page, 'demo-admin');
  await page.getByLabel('公告标题').fill(announcementTitle);
  await page.getByLabel('公告正文').fill('管理员通过真实界面创建公告。');
  await page.getByRole('button', { name: '保存公告草稿' }).click();
  await expect(page.getByRole('status')).toHaveText('公告草稿已创建');
  const announcementCard = page.locator('.record-card').filter({ hasText: announcementTitle });
  await announcementCard.getByRole('button', { name: `编辑 ${announcementTitle}` }).click();
  await announcementCard.getByLabel('编辑公告标题').fill(editedAnnouncementTitle);
  await announcementCard.getByLabel('编辑公告正文').fill('刷新后仍保留的公告正文。');
  await announcementCard.getByRole('button', { name: '保存公告修改' }).click();
  await expect(page.getByRole('status')).toHaveText('公告修改已保存');
  await page.reload();
  await switchUser(page, 'demo-admin');
  await expect(
    page.locator('.record-card').filter({ hasText: editedAnnouncementTitle }),
  ).toContainText('刷新后仍保留的公告正文。');

  const announcementResponse = await request.get(`${apiRoot}/information/announcements`, {
    headers: headers('demo-admin'),
  });
  const announcements = (await announcementResponse.json()) as {
    data: Array<{ id: string; title: string }>;
  };
  const announcement = announcements.data.find((item) => item.title === editedAnnouncementTitle);
  expect(announcement).toBeTruthy();
  await transition(request, 'announcements', announcement!.id, 'published');

  await switchUser(page, 'demo-student');
  await page.reload();
  await expect(page.getByRole('heading', { name: editedAnnouncementTitle })).toBeVisible();
  await expect(page.getByRole('link', { name: '分诊' })).toHaveCount(0);
  const denied = await request.patch(`${apiRoot}/information/announcements`, {
    headers: headers('demo-student'),
    data: { id: announcement!.id, title: '越权公告' },
  });
  expect([403, 404]).toContain(denied.status());

  await transition(request, 'announcements', announcement!.id, 'draft');
  await transition(request, 'announcements', announcement!.id, 'published');
  await transition(request, 'announcements', announcement!.id, 'archived');
  const illegalAnnouncement = await request.post(
    `${apiRoot}/information/announcements/${announcement!.id}/transitions`,
    { headers: headers('demo-admin'), data: { to: 'published' } },
  );
  expect(illegalAnnouncement.status()).toBe(409);

  await page.goto('./information/announcements');
  await switchUser(page, 'demo-admin');
  await expect(
    page.locator('.record-card').filter({ hasText: editedAnnouncementTitle }),
  ).toContainText('已归档');
  await page.goto('./information/triage');
  await switchUser(page, 'demo-admin');
  await expect(
    page.locator('.record-card').filter({ hasText: editedConsultationTitle }),
  ).toContainText('已关闭');

  await switchUser(page, 'demo-student');
  const proposalTitle = `E2E 提案 ${suffix}`;
  const proposalResponse = await request.post(`${apiRoot}/information/proposals`, {
    headers: headers('demo-student'),
    data: {
      title: proposalTitle,
      problemDescription: '夜间自习空间不足。',
      proposedSolution: '延长教学楼开放时间。',
      category: 'campus_service',
    },
  });
  expect(proposalResponse.status(), await proposalResponse.text()).toBe(201);
  await page.goto('./information/proposals');
  await page.getByRole('link', { name: `查看 ${proposalTitle}` }).click();
  await expect(page.getByRole('heading', { name: proposalTitle })).toBeVisible();
  await expect(page.getByRole('list', { name: '提案进展时间线' })).toBeVisible();
  await expect(page.getByText('内部备注')).toHaveCount(0);
});
