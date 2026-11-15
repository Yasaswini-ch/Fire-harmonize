// The PDF report: made ahead of time by pipeline/06_report_pdf.py (ReportLab) for the whole region over the full record, in
// the same theme and with the same numbers as the screen. A static site has no server to make one for a drawn area, so
// the panel says so. The link is a plain download.
export default function PdfReport({ region }) {
  const href = `${import.meta.env.BASE_URL}reports/${region.id}.pdf`;
  return (
    <section className="panel" aria-label="PDF report">
      <h2>PDF report</h2>
      <p className="hint">
        The calendar, the results in words, how to read each graph, how the numbers are made, the accuracy tables, and every
        annual total with its range and source flag. It covers the whole of {region.name} over the full record, not the area you drew.
      </p>
      <div className="button-row">
        <a className="button" href={href} download={`fire-harmonize-${region.id}.pdf`}>Download PDF report</a>
      </div>
    </section>
  );
}
