export default function NoCoverage({ regions, onPick }) {
  return (
    <section className="panel notice warn" role="alert">
      <h2>No data for this area</h2>
      <p>The area you chose does not overlap any processed region. Available regions:</p>
      <div className="button-row">
        {regions.map((r) => (
          <button key={r.id} type="button" onClick={() => onPick(r)}>{r.name}</button>
        ))}
      </div>
      <p>Data is processed for these demo regions. The pipeline can process any region, see README.</p>
    </section>
  );
}
