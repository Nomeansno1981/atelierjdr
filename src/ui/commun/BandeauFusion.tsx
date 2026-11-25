interface Proprietes {
  fusion: { remplacements: string[] } | null
  fermer: () => void
}

/** Annonce que le plan a été fusionné avec celui d'un autre appareil, et ce qui a été remplacé. */
export function BandeauFusion({ fusion, fermer }: Proprietes) {
  if (!fusion) return null
  const n = fusion.remplacements.length
  return (
    <div className="bandeau bandeau-attention bandeau-fusion" role="status">
      <p>
        Le plan avait aussi été modifié sur un autre appareil : les deux versions ont été fusionnées.
        {n === 0
          ? ' Aucune modification n’a été perdue.'
          : ` ${n === 1 ? 'Un changement fait' : `${n} changements faits`} des deux côtés au même endroit : la modification la plus récente l’emporte.`}
      </p>
      {n > 0 && (
        <ul>
          {fusion.remplacements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <button type="button" onClick={fermer}>
        Compris
      </button>
    </div>
  )
}
