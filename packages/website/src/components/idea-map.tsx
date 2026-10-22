export function IdeaMap() {
  return (
    <div
      className="idea-map"
      role="img"
      aria-label="Example connections between a balcony garden, fresh herbs, weekend plans and a sunnier corner"
    >
      <svg viewBox="0 0 420 220" aria-hidden="true">
        <g className="idea-map-lines">
          <path
            pathLength="1"
            d="M210 100Q150 35 82 52M210 100Q265 28 336 48M210 100Q285 100 340 158M210 100Q195 150 150 180M210 100Q135 135 60 144M82 52Q58 96 60 144M336 48Q368 105 340 158M60 144Q98 185 150 180"
          />
        </g>
        <g className="idea-map-stars">
          <circle cx="82" cy="52" r="6" />
          <circle cx="336" cy="48" r="5" />
          <circle cx="340" cy="158" r="7" />
          <circle cx="150" cy="180" r="6" />
          <circle cx="60" cy="144" r="4" />
          <circle cx="210" cy="100" r="12" />
          <circle className="idea-map-orbit" cx="210" cy="100" r="20" />
        </g>
        <g className="idea-map-titles">
          <text x="82" y="76">
            Fresh herbs
          </text>
          <text x="336" y="73">
            A sunnier corner
          </text>
          <text x="340" y="185">
            Weekend plans
          </text>
          <text x="150" y="207">
            Things to try
          </text>
          <text x="210" y="136">
            Balcony garden
          </text>
        </g>
      </svg>
    </div>
  );
}
