import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Atelier } from './etat/atelier'
import './styles/base.css'
import './styles/plan.css'
import './styles/redaction.css'

const atelier = new Atelier()
atelier.ecouterNavigateur()
void atelier.demarrer()

const racine = document.getElementById('racine')
if (!racine) throw new Error('Élément #racine introuvable')

createRoot(racine).render(
  <StrictMode>
    <App atelier={atelier} />
  </StrictMode>,
)
