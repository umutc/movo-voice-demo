import { CallsView, readFilters } from '@/components/console/calls-view';

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CallsView filters={readFilters(await searchParams)} />;
}
