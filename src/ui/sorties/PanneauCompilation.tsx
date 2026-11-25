import { useId, useState, type SubmitEvent } from 'react'
import { compiler, MODELE_PAR_DEFAUT, nomCompilation, versionSuivante } from '../../domaine/compilation'
import type { Plan } from '../../domaine/plan'
import { Dialogue } from '../commun/Dialogue'
import { CHEMIN_SCRIPT, derniereVersionLocale, noterVersionLocale, SCRIPT_COMPILATION, telecharger } from './fichiers'

interface Proprietes {
  plan: Plan
  textes: ReadonlyMap<string, string>
  /** Noms des compilations déjà dans le dépôt. */
  compilations: readonly string[]
  /** Clé de l'appareil pour ce dépôt (mémoire de la dernière version). */
  cleDepot: string
  enregistrer: (fichiers: { chemin: string; contenu: string }[], message: string) => Promise<string | null>
  fermer: () => void
}

/** Compile le manuscrit en un seul fichier Markdown, à télécharger ou à enregistrer dans le dépôt. */
export default function PanneauCompilation({ plan, textes, compilations, cleDepot, enregistrer, fermer }: Proprietes) {
  const modele = plan.reglages?.compilation?.modele ?? MODELE_PAR_DEFAUT
  const [version, setVersion] = useState(String(versionSuivante(modele, compilations, derniereVersionLocale(cleDepot))))
  const [vides, setVides] = useState<'incluses' | 'exclues'>('incluses')
  const [reperes, setReperes] = useState(false)
  const [destination, setDestination] = useState<'telechargement' | 'depot'>('telechargement')
  const [etat, setEtat] = useState<{ type: 'attente' } | { type: 'envoi' } | { type: 'fait'; message: string } | { type: 'erreur'; message: string }>({ type: 'attente' })
  const id = useId()

  const n = Math.max(1, Number.parseInt(version, 10) || 1)
  const nom = nomCompilation(modele, n)
  const existe = compilations.includes(nom)

  async function envoyer(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const contenu = compiler(plan, textes, { sectionsVides: vides, reperesPages: reperes })
    if (destination === 'telechargement') {
      telecharger(nom, contenu, 'text/markdown;charset=utf-8')
      noterVersionLocale(cleDepot, n)
      setEtat({ type: 'fait', message: `${nom} est téléchargé.` })
      return
    }
    if (existe && !window.confirm(`${nom} existe déjà dans compilations/. Le remplacer ? L’ancien reste dans l’historique GitHub.`)) return
    setEtat({ type: 'envoi' })
    const erreur = await enregistrer(
      [
        { chemin: `compilations/${nom}`, contenu },
        // Le script suit la version du site : les deux sorties restent identiques.
        { chemin: CHEMIN_SCRIPT, contenu: SCRIPT_COMPILATION },
      ],
      `Compilation : ${nom}`,
    )
    if (erreur) {
      setEtat({ type: 'erreur', message: erreur })
    } else {
      noterVersionLocale(cleDepot, n)
      setEtat({ type: 'fait', message: `${nom} est enregistré dans compilations/ du dépôt.` })
    }
  }

  return (
    <Dialogue titre="Compiler le manuscrit" onFermer={fermer}>
      <form className="formulaire" onSubmit={(e) => void envoyer(e)}>
        <label htmlFor={`${id}-version`}>Version</label>
        <input
          id={`${id}-version`}
          type="number"
          inputMode="numeric"
          min={1}
          value={version}
          onChange={(e) => {
            setVersion(e.target.value)
            setEtat({ type: 'attente' })
          }}
          required
        />
        <p className="aide">
          Fichier : <code>{nom}</code>
          {existe && ' (existe déjà dans le dépôt)'}
        </p>

        <fieldset className="choix-type">
          <legend>Sections vides</legend>
          <label>
            <input type="radio" name="vides" checked={vides === 'incluses'} onChange={() => { setVides('incluses') }} />
            Incluses (titre seul)
          </label>
          <label>
            <input type="radio" name="vides" checked={vides === 'exclues'} onChange={() => { setVides('exclues') }} />
            Exclues
          </label>
        </fieldset>

        <label className="case">
          <input type="checkbox" checked={reperes} onChange={(e) => { setReperes(e.target.checked) }} />
          Repères de pages sous chaque titre de section
        </label>

        <fieldset className="choix-type">
          <legend>Destination</legend>
          <label>
            <input
              type="radio"
              name="destination"
              checked={destination === 'telechargement'}
              onChange={() => { setDestination('telechargement') }}
            />
            Télécharger sur cet appareil
          </label>
          <label>
            <input type="radio" name="destination" checked={destination === 'depot'} onChange={() => { setDestination('depot') }} />
            Enregistrer dans le dépôt (compilations/)
          </label>
        </fieldset>

        {etat.type === 'fait' && (
          <p className="bandeau bandeau-attention" role="status">
            {etat.message}
          </p>
        )}
        {etat.type === 'erreur' && (
          <p className="bandeau bandeau-erreur" role="alert">
            {etat.message}
          </p>
        )}

        <div className="actions-formulaire">
          <span className="espace" />
          <button type="button" onClick={fermer}>
            Fermer
          </button>
          <button type="submit" className="bouton-principal" disabled={etat.type === 'envoi'}>
            {etat.type === 'envoi' ? 'Enregistrement…' : 'Compiler'}
          </button>
        </div>
      </form>
    </Dialogue>
  )
}
