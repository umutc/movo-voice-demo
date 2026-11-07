import { notFound } from 'next/navigation';
import { CallsView, readFilters } from '@/components/console/calls-view';

export default async function CallPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  return <CallsView filters={readFilters(await searchParams)} selectedId={id} />;
}
