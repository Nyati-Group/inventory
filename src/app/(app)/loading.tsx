import { PageSpinner } from "@/components/page-spinner";

// Shown instantly (inside the app shell) while any tab's data loads.
export default function Loading() {
  return <PageSpinner />;
}
