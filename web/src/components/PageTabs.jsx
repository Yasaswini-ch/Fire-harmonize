// The two pages of the workbench, switched with tabs under the header: the calendar and map, and the results in words.
const PAGES = [["workbench", "Calendar and map"], ["results", "Results and method"]];

export default function PageTabs({ page, onPage }) {
  return (
    <div className="page-tabs" role="tablist" aria-label="Page">
      {PAGES.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={page === id} onClick={() => onPage(id)}>{label}</button>
      ))}
    </div>
  );
}
