import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconeFermer } from './icones'

interface Proprietes {
  titre: string
  onFermer: () => void
  children: ReactNode
}

/**
 * Fenêtre modale fondée sur <dialog> : piège du focus, touche Échap et
 * fond assombri fournis par le navigateur. Elle s'ouvre à l'affichage du
 * composant et se ferme quand il disparaît.
 */
export function Dialogue({ titre, onFermer, children }: Proprietes) {
  const ref = useRef<HTMLDialogElement>(null)
  const idTitre = useId()

  useEffect(() => {
    const dialogue = ref.current
    if (dialogue && !dialogue.open) dialogue.showModal()
    return () => {
      dialogue?.close()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialogue"
      aria-labelledby={idTitre}
      onCancel={(e) => {
        e.preventDefault()
        onFermer()
      }}
      onClick={(e) => {
        // Un clic sur le fond (hors du contenu) ferme la fenêtre.
        if (e.target === ref.current) onFermer()
      }}
    >
      <div className="dialogue-contenu">
        <header className="dialogue-entete">
          <h2 id={idTitre}>{titre}</h2>
          <button type="button" className="bouton-icone" aria-label="Fermer" onClick={onFermer}>
            <IconeFermer />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
