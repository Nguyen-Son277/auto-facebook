import { listConnections } from "@/lib/facebook-connection";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser, resolveWorkspace } from "@/lib/dal";
import FacebookAppsClient from "./facebook-apps-client";
import WorkspaceSelect from "./workspace-select";
import PageHeader from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function FacebookAppsPage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;

  // Workspace hiện tại: từ query hoặc mặc định của user
  const ctx = await resolveWorkspace(params.ws ?? null);

  // Danh sách workspace để switcher
  const { listUserWorkspaces } = await import("@/lib/dal");
  const memberships = await listUserWorkspaces(user.id);
  const workspaces = memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    active: m.workspace.id === ctx.workspace.id,
  }));

  // Connections + trạng thái Page
  const connections = await listConnections(ctx.workspace.id);

  // Thống kê Page theo connection
  const pages = await prisma.facebookPage.findMany({
    where: { workspaceId: ctx.workspace.id },
    select: {
      id: true,
      name: true,
      fbPageId: true,
      connectionId: true,
      brandId: true,
      isActive: true,
      tokenExpiresAt: true,
    },
    orderBy: { name: "asc" },
  });

  const brands = await prisma.brand.findMany({
    where: { workspaceId: ctx.workspace.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const pagesByConnection = new Map<string, typeof pages>();
  const orphanPages: typeof pages = [];
  for (const p of pages) {
    if (p.connectionId) {
      const list = pagesByConnection.get(p.connectionId) ?? [];
      list.push(p);
      pagesByConnection.set(p.connectionId, list);
    } else {
      orphanPages.push(p);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="🔗 Facebook Apps"
        titleTestId="fbapps-title"
        description={<>Quản lý nhiều Facebook Graph API App trong workspace <strong>{ctx.workspace.name}</strong>. Mỗi App lấy được một nhóm Page khác nhau — dán token của App nào thì đồng bộ Page của App đó.</>}
        actions={
          <div className="min-w-0">
            <p className="ui-label">Workspace</p>
            <WorkspaceSelect workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))} />
          </div>
        }
      />

      <FacebookAppsClient
        workspaceId={ctx.workspace.id}
        connections={connections}
        pagesByConnection={Object.fromEntries(
          [...pagesByConnection.entries()].map(([k, v]) => [
            k,
            v.map((p) => ({
              id: p.id,
              name: p.name,
              fbPageId: p.fbPageId,
              isActive: p.isActive,
              brandId: p.brandId,
              tokenExpiresAt: p.tokenExpiresAt?.toISOString() ?? null,
            })),
          ])
        )}
        orphanPages={orphanPages.map((p) => ({
          id: p.id,
          name: p.name,
          fbPageId: p.fbPageId,
          isActive: p.isActive,
          brandId: p.brandId,
          tokenExpiresAt: p.tokenExpiresAt?.toISOString() ?? null,
        }))}
        brands={brands}
      />
    </div>
  );
}
