import PageTabs from "./PageTabs.jsx";

// Title and subtitle on the left; on the right the Walkthrough and the two page tabs, the region select (with a visible label), the data version read from
// meta.json, and a way back to the opening page.

export default function PageHeader({ regions, regionId, onRegion, version, onHome, onTour, page, onPage }) {
  return (
    <header className="page-header">
      <div className="title-block">
        <h1>Burning Activity Calendar</h1>
        <p className="subtitle">MODIS + VIIRS harmonized · NASA FIRMS</p>
      </div>
      <div className="header-right">
        {onTour && <button type="button" onClick={onTour}>Walkthrough</button>}
        {onPage && <PageTabs page={page} onPage={onPage} />}
        {onHome && <button type="button" className="ghost" onClick={onHome}>Home</button>}
        {regions && (
          <label className="region-select">
            <span>Region</span>
            <select value={regionId ?? ""} onChange={(e) => onRegion(regions.find((r) => r.id === e.target.value))}>
              {regionId === null && <option value="">Outside processed regions</option>}
              {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
        {version && <span className="chip" title="Data version, from meta.json">Data {version}</span>}
      </div>
    </header>
  );
}
