import { notFound } from "next/navigation";
import { SpacesPage } from "../../../components/spaces/SpacesPage";
import { SPACE_PAGES } from "../../../lib/nav-layout";

export function generateStaticParams() { return SPACE_PAGES.map(({ id }) => ({ category: id })); }
export default async function Page({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!SPACE_PAGES.some((p) => p.id === category)) notFound();
  return <SpacesPage category={category} />;
}
