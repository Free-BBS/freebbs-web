import {
  SOCIAL_ORGANIZATION_IDS,
  type SocialOrganizationId,
  type UnifiedRegistration,
} from '@freebbs-development/contracts';

export function parseRegistrationOrganizations(value: string | null): SocialOrganizationId[] {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .filter((id): id is SocialOrganizationId =>
          (SOCIAL_ORGANIZATION_IDS as readonly string[]).includes(id),
        ),
    ),
  ];
}

export function filterRegistrationsByOrganization(
  items: readonly UnifiedRegistration[],
  ids: readonly SocialOrganizationId[],
): UnifiedRegistration[] {
  return items.filter(
    (item) =>
      ids.length === 0 || (item.organizationId != null && ids.includes(item.organizationId)),
  );
}
