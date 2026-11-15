import AccuracyPanel from "./AccuracyPanel.jsx";
import DownloadPanel from "./DownloadPanel.jsx";
import { ExportButton } from "./ExportRegistry.jsx";
import MethodsPanel from "./MethodsPanel.jsx";
import PdfReport from "./PdfReport.jsx";

// Two collapsed sections under the charts (native details elements, closed by default).
//   Accuracy and methods: the accuracy graphs and everything the pipeline measured, read from meta.json.
//   Export: both CSV files, the three chart images, and the PDF report.
export default function MoreSections({
  meta, region, aoi, rangeRows, cellsData, estimatedRange, context,
}) {
  return (
    <div className="more">
      <details className="more-item" data-details="accuracy">
        <summary>Accuracy and methods</summary>
        <div className="more-body">
          <AccuracyPanel meta={meta} regionId={region.id} regionName={region.name} />
          <MethodsPanel bare meta={meta} regionId={region.id} regionName={region.name} estimatedRange={estimatedRange} />
        </div>
      </details>

      <details className="more-item" data-details="export">
        <summary>Export</summary>
        <div className="more-body">
          <DownloadPanel region={region} aoi={aoi} start={context.start} end={context.end} rangeRows={rangeRows} cellsData={cellsData} />
          <section className="panel" aria-label="Image downloads">
            <h2>Chart images</h2>
            <p className="hint">Each image includes the title, the area, the period and a legend.</p>
            <div className="btn-row">
              <ExportButton name="calendar" className="ghost">Calendar image</ExportButton>
              <ExportButton name="seasonal" className="ghost">Seasonal profile image</ExportButton>
              <ExportButton name="anomaly" className="ghost">Annual anomaly image</ExportButton>
            </div>
          </section>
          <PdfReport region={region} />
        </div>
      </details>
    </div>
  );
}
