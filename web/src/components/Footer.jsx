const L = {
  firms: "https://www.earthdata.nasa.gov/data/tools/firms",
  faq: "https://www.earthdata.nasa.gov/data/tools/firms/faq",
  api: "https://firms.modaps.eosdis.nasa.gov/api/area/",
};

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
      <p><strong>Harmonized values are model estimates, not observations.</strong></p>
      <p>
        Data: NASA <a href={L.firms}>Fire Information for Resource Management System (FIRMS)</a>, part of NASA LANCE and ESDIS.
        MODIS Collection 6.1 active fire (Aqua; standard processing and near real time) and VIIRS 375 m active fire
        (Suomi NPP and NOAA-20; standard processing and near real time). See the <a href={L.faq}>FIRMS FAQ</a> and
        the <a href={L.api}>FIRMS Area API</a> for product details.
      </p>
      </div>
    </footer>
  );
}
