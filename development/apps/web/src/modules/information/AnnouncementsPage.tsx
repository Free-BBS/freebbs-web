import type { InformationPageProps } from './InformationPage.js';
import { InformationPage } from './InformationPage.js';
import { InformationLayout } from './InformationLayout.js';

export function AnnouncementsPage(props: InformationPageProps) {
  return (
    <InformationLayout title="公开信息" user={props.user}>
      <InformationPage {...props} view="announcements" />
    </InformationLayout>
  );
}
