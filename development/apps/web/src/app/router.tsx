import type { InformationFeedFilter, ModuleManifest } from '@freebbs-development/contracts';
import type { ReactNode } from 'react';
import { Navigate, RouterProvider, createBrowserRouter, useLoaderData } from 'react-router-dom';
import { useMatches, useParams, useSearchParams } from 'react-router-dom';

import { createApiClient } from '../core/api/client.js';
import { useAuth } from '../core/auth/AuthProvider.js';
import type { PresentationUser } from '../core/permissions/Can.js';
import { SuperAdminRouteGuard } from '../core/permissions/SuperAdminRouteGuard.js';
import { AdminPage } from '../modules/admin/AdminPage.js';
import { CollectionsLandingPage } from '../modules/collections/CollectionsLandingPage.js';
import { MyRegistrations } from '../modules/collections/MyRegistrations.js';
import { RegistrationGallery } from '../modules/collections/RegistrationGallery.js';
import { ShowcaseDetailPage } from '../modules/collections/ShowcaseDetailPage.js';
import { ShowcasePage } from '../modules/collections/ShowcasePage.js';
import { CollectionWorkbench } from '../modules/collections/builder/CollectionWorkbench.js';
import { CommunityPage } from '../modules/community/CommunityPage.js';
import { DashboardPage } from '../modules/dashboard/DashboardPage.js';
import { DeskPage } from '../modules/desk/DeskPage.js';
import { ActivityDetailPage } from '../modules/events/ActivityDetailPage.js';
import { EventsPage } from '../modules/events/EventsPage.js';
import { FestivalPage } from '../modules/festival/FestivalPage.js';
import { FinancePage } from '../modules/finance/FinancePage.js';
import { GrowthPage } from '../modules/growth/GrowthPage.js';
import { InformationHubPage } from '../modules/information/InformationHubPage.js';
import { InformationLayout } from '../modules/information/InformationLayout.js';
import { ProposalDetailPage } from '../modules/information/ProposalDetailPage.js';
import { ProposalPool } from '../modules/information/ProposalPool.js';
import { KnowledgePage } from '../modules/knowledge/KnowledgePage.js';
import { KnowledgeDetailPage } from '../modules/knowledge/KnowledgeDetailPage.js';
import { LiaisonPage } from '../modules/liaison/LiaisonPage.js';
import { ProblemDetailPage } from '../modules/liaison/ProblemDetailPage.js';
import { SportsPage } from '../modules/sports/SportsPage.js';
import { SportsMatchesPage } from '../modules/sports/SportsMatchesPage.js';
import { SportsTeamDetailPage } from '../modules/sports/SportsTeamDetailPage.js';
import { AppShell } from './AppShell.js';
import { CommercePage } from './CommercePage.js';
import {
  MODULE_MANIFESTS,
  resolveModuleStatus,
  type ModuleStateOverrides,
} from './module-manifests.js';
import { OrganizationsPage } from '../modules/organizations/OrganizationsPage.js';

export async function loadModuleStates(): Promise<ModuleStateOverrides> {
  try {
    const modules = await createApiClient().request<ModuleManifest[]>('/modules');
    const knownIds = new Set(MODULE_MANIFESTS.map((module) => module.id));
    return Object.fromEntries(
      modules
        .filter((module) => knownIds.has(module.id))
        .map((module) => [module.id, module.status]),
    ) as ModuleStateOverrides;
  } catch {
    return Object.fromEntries(
      MODULE_MANIFESTS.map((module) => [module.id, 'disabled']),
    ) as ModuleStateOverrides;
  }
}

function AppShellRoute() {
  const moduleStates = useLoaderData() as ModuleStateOverrides;
  return <AppShell moduleStates={moduleStates} />;
}

function DashboardRoute() {
  const auth = useAuth();
  return <DashboardPage key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function ProfileRoute() {
  const auth = useAuth();
  return <CommercePage section="profile" userUid={auth.user?.uid} />;
}

function KnowledgeRoute() {
  const auth = useAuth();
  const [search] = useSearchParams();
  const audience = search.get('audience') === 'social_org' ? 'social_org' : 'general';
  return (
    <KnowledgePage key={`${auth.demoUser ?? auth.user?.uid}:${audience}`} client={auth.client} />
  );
}

function KnowledgeDetailRoute() {
  const auth = useAuth();
  const { entryId = '' } = useParams();
  const [search] = useSearchParams();
  const audience = search.get('audience') === 'social_org' ? 'social_org' : 'general';
  return (
    <KnowledgeDetailPage
      key={`${auth.demoUser ?? auth.user?.uid}:${entryId}:${audience}`}
      client={auth.client}
      entryId={entryId}
      audience={audience}
    />
  );
}

function InformationHubRoute() {
  const auth = useAuth();
  const [search, setSearch] = useSearchParams();
  const filter = search.get('filter');
  const initialFilter: InformationFeedFilter = [
    'all',
    'official',
    'public_feedback',
    'mine',
    'in_progress',
    'resolved',
  ].includes(filter ?? '')
    ? (filter as InformationFeedFilter)
    : 'all';
  return (
    <InformationHubPage
      key={auth.demoUser ?? auth.user?.uid}
      client={auth.client}
      user={auth.user}
      filter={initialFilter}
      onFilterChange={(nextFilter) => {
        setSearch(
          (current) => {
            const next = new URLSearchParams(current);
            next.set('filter', nextFilter);
            return next;
          },
          { preventScrollReset: true },
        );
      }}
    />
  );
}

function DeskRoute({ children }: { children?: ReactNode }) {
  const matches = useMatches();
  const moduleStates = matches[0]?.data as ModuleStateOverrides | undefined;
  return <DeskPage moduleStates={moduleStates}>{children}</DeskPage>;
}

function ProposalPoolRoute() {
  const auth = useAuth();
  return (
    <InformationLayout title="公开提案池" user={auth.user}>
      <ProposalPool client={auth.client} user={auth.user} />
    </InformationLayout>
  );
}

function ProposalDetailRoute() {
  const auth = useAuth();
  const { proposalId = '' } = useParams();
  return (
    <InformationLayout title="提案详情" user={auth.user}>
      <ProposalDetailPage client={auth.client} proposalId={proposalId} user={auth.user} />
    </InformationLayout>
  );
}

function GrowthRoute() {
  const auth = useAuth();
  return (
    <GrowthPage
      key={auth.demoUser ?? auth.user?.uid}
      client={auth.client}
      uid={auth.user?.uid ?? ''}
      displayName={auth.user?.displayName ?? '同学'}
    />
  );
}

function OrganizationsRoute() {
  const { organizationKey, departmentKey } = useParams();
  const matches = useMatches();
  const states = matches[0]?.data as ModuleStateOverrides | undefined;
  const information = MODULE_MANIFESTS.find((module) => module.id === 'information')!;
  return (
    <OrganizationsPage
      organizationKey={organizationKey}
      departmentKey={departmentKey}
      enabled={resolveModuleStatus(information, states) === 'enabled'}
    />
  );
}

function EventsRoute() {
  const auth = useAuth();
  return <EventsPage key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function ActivityDetailRoute() {
  const auth = useAuth();
  const { activityId = '' } = useParams();
  return (
    <ActivityDetailPage
      key={`${auth.demoUser ?? auth.user?.uid}:${activityId}`}
      activityId={activityId}
      client={auth.client}
    />
  );
}

function FestivalRoute() {
  const auth = useAuth();
  return <FestivalPage key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function LiaisonRoute() {
  const auth = useAuth();
  return <LiaisonPage key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function CollectionsRoute() {
  const auth = useAuth();
  return <CollectionsLandingPage key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function CommunityRoute() {
  const auth = useAuth();
  const { postId } = useParams();
  return (
    <CommunityPage
      key={`${auth.demoUser ?? auth.user?.uid}:${postId ?? 'feed'}`}
      client={auth.client}
      initialPostId={postId}
    />
  );
}

function RegistrationGalleryRoute() {
  const auth = useAuth();
  return <RegistrationGallery key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function MyRegistrationsRoute() {
  const auth = useAuth();
  return <MyRegistrations key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function ShowcaseRoute() {
  const auth = useAuth();
  return <ShowcasePage key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function ShowcaseDetailRoute() {
  const auth = useAuth();
  return <ShowcaseDetailPage key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function CollectionWorkbenchRoute() {
  const auth = useAuth();
  return <CollectionWorkbench key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function ProblemDetailRoute() {
  const auth = useAuth();
  const { problemId = '' } = useParams();
  return (
    <ProblemDetailPage
      key={`${auth.demoUser ?? auth.user?.uid}:${problemId}`}
      client={auth.client}
      problemId={problemId}
      user={auth.user}
    />
  );
}

function SportsRoute() {
  const auth = useAuth();
  return <SportsPage key={auth.demoUser ?? auth.user?.uid} client={auth.client} user={auth.user} />;
}

function SportsMatchesRoute() {
  const auth = useAuth();
  return (
    <SportsMatchesPage
      key={auth.demoUser ?? auth.user?.uid}
      client={auth.client}
      user={auth.user}
    />
  );
}

function SportsTeamDetailRoute() {
  const { teamId = '' } = useParams();
  return <SportsTeamDetailPage teamId={teamId} />;
}

function FinanceRoute() {
  const auth = useAuth();
  return <FinancePage key={auth.demoUser ?? auth.user?.uid} client={auth.client} />;
}

function AdminRoute() {
  const auth = useAuth();
  return (
    <SuperAdminRouteGuard user={auth.user as PresentationUser | null}>
      <AdminPage key={auth.demoUser ?? auth.user?.uid} client={auth.client} />
    </SuperAdminRouteGuard>
  );
}

export const appRouter = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShellRoute />,
      loader: loadModuleStates,
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        { path: 'dashboard', element: <DashboardRoute /> },
        { path: 'shop', element: <CommercePage section="shop" /> },
        { path: 'inventory', element: <CommercePage section="inventory" /> },
        { path: 'ranch', element: <CommercePage section="ranch" /> },
        { path: 'ranch-gallery', element: <CommercePage section="ranch-gallery" /> },
        { path: 'ranch-dye', element: <CommercePage section="ranch-dye" /> },
        { path: 'profile', element: <ProfileRoute /> },
        { path: 'settings', element: <CommercePage section="settings" /> },
        { path: 'desk', element: <DeskRoute /> },
        {
          path: 'desk/information',
          element: (
            <DeskRoute>
              <InformationHubRoute />
            </DeskRoute>
          ),
        },
        {
          path: 'desk/knowledge',
          element: (
            <DeskRoute>
              <KnowledgeRoute />
            </DeskRoute>
          ),
        },
        {
          path: 'desk/knowledge/:entryId',
          element: (
            <DeskRoute>
              <KnowledgeDetailRoute />
            </DeskRoute>
          ),
        },
        {
          path: 'desk/information/proposals',
          element: (
            <DeskRoute>
              <ProposalPoolRoute />
            </DeskRoute>
          ),
        },
        {
          path: 'desk/information/proposals/:proposalId',
          element: (
            <DeskRoute>
              <ProposalDetailRoute />
            </DeskRoute>
          ),
        },
        {
          path: 'knowledge',
          element: (
            <DeskRoute>
              <KnowledgeRoute />
            </DeskRoute>
          ),
        },
        {
          path: 'knowledge/:entryId',
          element: (
            <DeskRoute>
              <KnowledgeDetailRoute />
            </DeskRoute>
          ),
        },
        {
          path: 'information',
          element: (
            <DeskRoute>
              <InformationHubRoute />
            </DeskRoute>
          ),
        },
        {
          path: 'information/announcements',
          element: <Navigate to="/information?filter=official" replace />,
        },
        {
          path: 'information/consultations',
          element: <Navigate to="/information?filter=mine" replace />,
        },
        {
          path: 'information/triage',
          element: <Navigate to="/information?filter=in_progress" replace />,
        },
        {
          path: 'information/proposals',
          element: (
            <DeskRoute>
              <ProposalPoolRoute />
            </DeskRoute>
          ),
        },
        {
          path: 'information/proposals/:proposalId',
          element: (
            <DeskRoute>
              <ProposalDetailRoute />
            </DeskRoute>
          ),
        },
        { path: 'growth', element: <GrowthRoute /> },
        { path: 'organizations', element: <OrganizationsRoute /> },
        { path: 'organizations/:organizationKey', element: <OrganizationsRoute /> },
        { path: 'organizations/:organizationKey/:departmentKey', element: <OrganizationsRoute /> },
        { path: 'interest-groups', element: <Navigate to="/growth" replace /> },
        { path: 'clubs', element: <Navigate to="/growth" replace /> },
        { path: 'events', element: <EventsRoute /> },
        { path: 'events/student-festival', element: <FestivalRoute /> },
        { path: 'collections', element: <CollectionsRoute /> },
        { path: 'collections/registrations', element: <RegistrationGalleryRoute /> },
        { path: 'collections/mine', element: <MyRegistrationsRoute /> },
        { path: 'collections/showcase', element: <ShowcaseRoute /> },
        { path: 'collections/showcase/:articleId', element: <ShowcaseDetailRoute /> },
        { path: 'collections/workbench/:collectionId', element: <CollectionWorkbenchRoute /> },
        { path: 'community', element: <CommunityRoute /> },
        { path: 'community/posts/:postId', element: <CommunityRoute /> },
        { path: 'liaison', element: <LiaisonRoute /> },
        { path: 'liaison/problems/:problemId', element: <ProblemDetailRoute /> },
        { path: 'events/:activityId', element: <ActivityDetailRoute /> },
        { path: 'sports', element: <SportsRoute /> },
        { path: 'sports/matches', element: <SportsMatchesRoute /> },
        { path: 'sports/:teamId', element: <SportsTeamDetailRoute /> },
        { path: 'finance', element: <FinanceRoute /> },
        { path: 'admin', element: <AdminRoute /> },
        { path: '*', element: <Navigate to="/dashboard" replace /> },
      ],
    },
  ],
  { basename: '/development' },
);

export function AppRouter() {
  return <RouterProvider router={appRouter} />;
}
