import type { ReactNode } from 'react'

function Icone({ children, taille = 18 }: { children: ReactNode; taille?: number }) {
  return (
    <svg
      className="icone"
      viewBox="0 0 20 20"
      width={taille}
      height={taille}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/** Icône d'un hors-texte : un cadre d'image. Porte son propre nom accessible. */
export function IconeHorsTexte() {
  return (
    <svg
      className="icone"
      viewBox="0 0 16 16"
      width="14"
      height="14"
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

export const IconeAnnuler = () => (
  <Icone>
    <path d="M7 5 3.5 8.5 7 12" />
    <path d="M4 8.5h8a4.5 4.5 0 0 1 0 9H9" />
  </Icone>
)

export const IconeRetablir = () => (
  <Icone>
    <path d="m13 5 3.5 3.5L13 12" />
    <path d="M16 8.5H8a4.5 4.5 0 0 0 0 9h3" />
  </Icone>
)

export const IconeCorbeille = () => (
  <Icone>
    <path d="M3.5 5.5h13M8 5.5V3.5h4v2M5.5 5.5l.8 11h7.4l.8-11" />
  </Icone>
)

export const IconeReglages = () => (
  <Icone>
    <path d="M3 6h9M15 6h2M3 14h2M8 14h9" />
    <circle cx="13.5" cy="6" r="1.8" />
    <circle cx="6.5" cy="14" r="1.8" />
  </Icone>
)

export const IconeSynchro = () => (
  <Icone>
    <path d="M16 10a6 6 0 0 1-10.5 4M4 10a6 6 0 0 1 10.5-4" />
    <path d="M14.5 2.5v3.5H11M5.5 17.5V14H9" />
  </Icone>
)

export const IconePoints = () => (
  <Icone taille={16}>
    <circle cx="4.5" cy="10" r="0.9" fill="currentColor" />
    <circle cx="10" cy="10" r="0.9" fill="currentColor" />
    <circle cx="15.5" cy="10" r="0.9" fill="currentColor" />
  </Icone>
)

export const IconePlus = () => (
  <Icone taille={14}>
    <path d="M10 4v12M4 10h12" />
  </Icone>
)

export const IconeMoins = () => (
  <Icone taille={14}>
    <path d="M4 10h12" />
  </Icone>
)

export const IconeFermer = () => (
  <Icone>
    <path d="m5 5 10 10M15 5 5 15" />
  </Icone>
)

/** Petit chevron vers le bas : ce bouton ouvre une liste. */
export const IconeChevron = () => (
  <Icone taille={14}>
    <path d="m5 8 5 5 5-5" />
  </Icone>
)
