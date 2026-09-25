import type { InformationPageProps } from './InformationPage.js';
import { InformationPage } from './InformationPage.js';
import { InformationLayout } from './InformationLayout.js';

export function TriagePage(props: InformationPageProps) {
  return (
    <InformationLayout title="咨询分诊" user={props.user}>
      <InformationPage {...props} view="triage" />
    </InformationLayout>
  );
}
