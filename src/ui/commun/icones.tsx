/** Icône d'un hors-texte : un cadre d'image. */
export function IconeHorsTexte() {
  return (
    <svg
      className="icone"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      role="img"
      aria-label="Hors-texte"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1" />
      <path d="M2.5 11.5 6 8l2.5 2.5L10.5 8.5l3 3" />
      <circle cx="10.5" cy="5.75" r="1.1" />
    </svg>
  )
}
