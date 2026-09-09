export default function PlaceholderPage({
  icon,title }) {
  return <div className="proto-card empty-state">
    <i className={`bi bi-${icon}`} />
      <h2>
        {title}
          </h2>
            <p>This workspace section is ready to be expanded with your organization’s workflow.</p></div>;
}
