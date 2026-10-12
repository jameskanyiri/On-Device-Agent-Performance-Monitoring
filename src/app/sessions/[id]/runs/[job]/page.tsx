import { redirect } from 'next/navigation';

/** Runs open in a side panel on their eval's page now; old links land there. */
export default async function Page(props: PageProps<'/sessions/[id]/runs/[job]'>) {
  const { id, job } = await props.params;
  redirect(`/sessions/${id}?run=${job}`);
}
