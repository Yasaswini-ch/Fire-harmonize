export default function DateRange({ region, start, end, error, onChange }) {
  return (
    <section className="daterange" aria-label="Date range">
      <div className="fields two">
        <label>
          <span>From</span>
          <input type="month" value={start} min={region.firstMonth} max={region.lastMonth} placeholder="YYYY-MM"
            onChange={(e) => onChange("start", e.target.value)} />
        </label>
        <label>
          <span>To</span>
          <input type="month" value={end} min={region.firstMonth} max={region.lastMonth} placeholder="YYYY-MM"
            onChange={(e) => onChange("end", e.target.value)} />
        </label>
      </div>
      {error ? <p className="field-error" role="alert">{error}</p>
        : <p className="hint">Data available {region.firstMonth} to {region.lastMonth}.</p>}
    </section>
  );
}
