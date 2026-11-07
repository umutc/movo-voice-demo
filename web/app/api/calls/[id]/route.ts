import { NextResponse } from 'next/server';
import { getCallView } from 'db/read';

// Read-only view of one call for the booked page: booking details, the saved summary, timing.
// Every value comes from the database; nothing is typed in.
export const revalidate = 0;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse('bad id', { status: 400 });
  const url = process.env.DATABASE_URL;
  if (!url) return new NextResponse('DATABASE_URL is not configured', { status: 500 });
  const view = await getCallView(url, id);
  if (!view) return new NextResponse('not found', { status: 404 });
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
}
