import { expect, test, type Page } from '@playwright/test'
import { lirePlan } from '../src/domaine/plan'
import {
  brancherFauxGitHub,
  etat,
  FauxGitHub,
  glisserDoigt,
  glisserSouris,
  lireExemple,
  postit,
  seConnecter,
  surveillerErreurs,
  titres,
  TITRES,
} from './outils'

async function ouvrir(page: Page) {
  const erreurs = surveillerErreurs(page)
  const faux = await FauxGitHub.creer(lireExemple())
  await brancherFauxGitHub(page, faux)
  await page.goto('./')
  await seConnecter(page)
  await expect(etat(page)).toHaveText('Synchronisé')
  return { faux, erreurs }
}

/** Ordre des sections dans le plan.json actuellement sur le faux GitHub. */
function ordreSurGitHub(faux: FauxGitHub): string[] {
  return lirePlan(faux.fichiers()['plan.json'] ?? '').sections.map((s) => s.titre.replace(/\s/g, ' '))
}

const sauf = (liste: string[], ...retires: string[]) => liste.filter((t) => !retires.includes(t))

test.describe('à la souris', () => {
  test.skip(({ isMobile }) => isMobile, 'souris : ordinateur seulement')

  test('glisser-déposer réordonne, recalcule la pagination et envoie un commit', async ({ page }) => {
    const { faux, erreurs } = await ouvrir(page)
    // « Créer son personnage » avant « Avant-propos » (page 2).
    await glisserSouris(page, postit(page, 'Créer son personnage'), page.locator('.page[data-page="2"]'))
    const attendu = ['Page de titre', 'Créer son personnage', ...sauf(TITRES, 'Page de titre', 'Créer son personnage')]
    await expect(titres(page)).toHaveText(attendu)
    await expect(etat(page)).toHaveText('Enregistré sur l’appareil')

    // Envoi groupé environ 5 s plus tard.
    await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
    expect(ordreSurGitHub(faux)).toEqual(attendu)
    // Placée entre deux sections de la Présentation, elle en prend la partie.
    expect(faux.messages()[0]).toBe('Plan : déplacement de Créer son personnage dans la partie Présentation')
    expect(erreurs).toEqual([])
  })

  test('pendant le glissement, la grille reste fixe et une ligne rouge marque l’arrivée', async ({ page }) => {
    await ouvrir(page)
    const source = await postit(page, 'Avant-propos').boundingBox()
    const cible = await page.locator('.page[data-page="1"]').boundingBox()
    if (!source || !cible) throw new Error('invisible')
    await page.mouse.move(source.x + 20, source.y + 40)
    await page.mouse.down()
    await page.mouse.move(cible.x + 10, cible.y + cible.height / 2, { steps: 12 })
    await page.waitForTimeout(150)
    await page.mouse.move(cible.x + 12, cible.y + cible.height / 2, { steps: 2 })
    // Rien ne bouge : l'ordre affiché est inchangé, Avant-propos reste à sa
    // place, estompé, et aucune page blanche n'apparaît encore.
    await expect(titres(page)).toHaveText(TITRES)
    await expect(page.locator('.postit-source')).toHaveCount(1)
    await expect(page.locator('.page-blanche[data-page="2"]')).toHaveCount(0)
    // La ligne d'insertion est au bord gauche de « Page de titre », et la
    // silhouette annonce l'arrivée : page 1, dans la Présentation.
    await expect(page.locator('.postit[data-insertion]')).toHaveCount(1)
    await expect(page.locator('.postit[data-insertion="avant"] .postit-titre')).toHaveText('Page de titre')
    await expect(page.locator('.fantome-destination')).toHaveText('p. 1 · I. Présentation')
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(titres(page)).toHaveText(TITRES)
    await expect(page.locator('.postit[data-insertion], .postit-source')).toHaveCount(0)
  })

  test('sur la seconde moitié d’une section, la ligne passe à son bord droit', async ({ page }) => {
    await ouvrir(page)
    const source = await postit(page, 'Créer son personnage').boundingBox()
    const cible = await postit(page, 'Avant-propos').boundingBox()
    if (!source || !cible) throw new Error('invisible')
    await page.mouse.move(source.x + source.width / 2, source.y + 40)
    await page.mouse.down()
    await page.mouse.move(source.x + source.width / 2 + 10, source.y + 50, { steps: 3 })
    await page.mouse.move(cible.x + cible.width * 0.85, cible.y + cible.height / 2, { steps: 12 })
    await page.waitForTimeout(150)
    await page.mouse.move(cible.x + cible.width * 0.86, cible.y + cible.height / 2, { steps: 2 })
    await expect(page.locator('.postit[data-insertion="apres"] .postit-titre')).toHaveText('Avant-propos')
    await page.mouse.up()
    await expect(titres(page)).toHaveText([
      'Page de titre',
      'Avant-propos',
      'Créer son personnage',
      ...sauf(TITRES, 'Page de titre', 'Avant-propos', 'Créer son personnage'),
    ])
  })

  test('glisser vers le haut fait défiler la page, la cible reste juste', async ({ page }) => {
    await ouvrir(page)
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
    })
    const source = await postit(page, 'Lexique').boundingBox()
    if (!source) throw new Error('invisible')
    await page.mouse.move(source.x + source.width / 2, source.y + 40)
    await page.mouse.down()
    await page.mouse.move(source.x + source.width / 2, source.y + 60, { steps: 3 })
    // Bord haut de la fenêtre : défilement automatique jusqu'en haut.
    await page.mouse.move(source.x + source.width / 2, 40, { steps: 10 })
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 }).toBe(0)
    const cible = await page.locator('.page[data-page="2"]').boundingBox()
    if (!cible) throw new Error('invisible')
    await page.mouse.move(cible.x + 8, cible.y + cible.height / 2, { steps: 10 })
    await page.waitForTimeout(150)
    await page.mouse.move(cible.x + 9, cible.y + cible.height / 2, { steps: 2 })
    await page.mouse.up()
    await expect(titres(page)).toHaveText(['Page de titre', 'Lexique', ...sauf(TITRES, 'Page de titre', 'Lexique')])
  })
})

test.describe('au doigt', () => {
  test.skip(({ isMobile }) => !isMobile, 'tactile : tablette et téléphone')

  test('appui long puis glisser réordonne ; la pagination suit', async ({ page }) => {
    const { faux, erreurs } = await ouvrir(page)
    // Avant-propos en tête : Page de titre (début à droite) passe en page 3,
    // une blanche s'insère en page 2.
    await glisserDoigt(page, postit(page, 'Avant-propos'), page.locator('.page[data-page="1"]'))
    await expect(titres(page)).toHaveText(['Avant-propos', 'Page de titre', ...sauf(TITRES, 'Page de titre', 'Avant-propos')])
    await expect(page.locator('.page-blanche[data-page="2"]')).toBeVisible()

    // Et on remet en ordre.
    await glisserDoigt(page, postit(page, 'Page de titre'), page.locator('.page[data-page="1"]'))
    await expect(titres(page)).toHaveText(TITRES)
    await expect(page.locator('.barre-etat')).toContainText('Pages 19')

    await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
    expect(ordreSurGitHub(faux)).toEqual(TITRES)
    expect(erreurs).toEqual([])
  })

  test('cinq réorganisations de suite, sans erreur', async ({ page }) => {
    const { faux, erreurs } = await ouvrir(page)
    const normal = (t: string) => t.replace(/\u00a0/g, ' ')
    // Chaque section glissée sur la première moitié de la page 2 se place
    // juste après « Page de titre ».
    const deplacees = ['Créer son personnage', 'Le heurt', 'Avant-propos', 'Créer son personnage', 'Qu’est-ce que Katastrophê ?']
    let attendu = [...TITRES]
    for (const titre of deplacees) {
      await glisserDoigt(page, postit(page, titre), page.locator('.page[data-page="2"]'))
      attendu = ['Page de titre', titre, ...attendu.filter((t) => t !== 'Page de titre' && t !== titre)]
      await expect(titres(page)).toHaveText(attendu)
    }
    await expect(page.locator('.barre-etat')).toContainText('Pages 19')
    await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
    expect(ordreSurGitHub(faux).map(normal)).toEqual(attendu)
    expect(erreurs).toEqual([])
  })

  test('un glissement rapide fait défiler sans déplacer de post-it', async ({ page }) => {
    await ouvrir(page)
    await glisserDoigt(page, postit(page, 'Avant-propos'), page.locator('.page[data-page="1"]'), 20)
    await expect(titres(page)).toHaveText(TITRES)
  })
})

test.describe('au clavier', () => {
  test.skip(({ isMobile }) => isMobile, 'clavier : ordinateur seulement')

  test('Espace saisit, les flèches déplacent, Entrée dépose', async ({ page }) => {
    await ouvrir(page)
    const bouton = postit(page, 'Lexique').locator('.postit-principal')
    await bouton.focus()
    await page.keyboard.press('Space')
    await expect(page.locator('.lecteur-ecran[aria-live="assertive"]')).toContainText('Lexique saisi')
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.lecteur-ecran[aria-live="assertive"]')).toContainText('position 2 sur 10')
    // Le focus suit le post-it.
    await expect(postit(page, 'Lexique').locator('.postit-principal')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(titres(page)).toHaveText(['Page de titre', 'Lexique', ...sauf(TITRES, 'Page de titre', 'Lexique')])
  })

  test('Échap annule le déplacement', async ({ page }) => {
    await ouvrir(page)
    await postit(page, 'Lexique').locator('.postit-principal').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Escape')
    await expect(titres(page)).toHaveText(TITRES)
  })

  test('Cmd/Ctrl+Z annule, Cmd/Ctrl+Maj+Z rétablit', async ({ page }) => {
    await ouvrir(page)
    await postit(page, 'Le heurt').getByRole('button', { name: 'Une page de plus pour Le heurt' }).click()
    await expect(postit(page, 'Le heurt').locator('.postit-pages')).toContainText('3 p.')
    // Une page de plus décale tout : deux blanches apparaissent, 21 pages.
    await expect(page.locator('.barre-etat')).toContainText('Pages 21')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(postit(page, 'Le heurt').locator('.postit-pages')).toContainText('2 p.')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(postit(page, 'Le heurt').locator('.postit-pages')).toContainText('3 p.')
  })
})

test('créer une section : fichier vide créé sur GitHub', async ({ page }) => {
  const { faux, erreurs } = await ouvrir(page)
  await page.getByRole('button', { name: 'Nouvelle section', exact: true }).click()
  const dialogue = page.getByRole('dialog', { name: 'Nouvelle section' })
  await dialogue.getByLabel('Titre', { exact: true }).fill('Les dés')
  await dialogue.getByLabel('Pages', { exact: true }).fill('2')
  await dialogue.getByRole('button', { name: 'Créer', exact: true }).click()
  await expect(titres(page).last()).toHaveText('Les dés')
  // Le livre grandit avec ses sections : 21 pages, aucune limite dépassée.
  await expect(page.locator('.barre-etat')).toContainText('Pages 21')
  await expect(page.locator('.page[data-page="21"]')).toBeVisible()
  await expect(page.locator('.page[data-page="22"]')).toHaveCount(0)

  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  expect(faux.fichiers()['sections/les-des.md']).toBe('')
  expect(faux.messages()[0]).toBe('Plan : création de Les dés')
  expect(erreurs).toEqual([])
})

test('un seul « + » entre deux post-its, posé entre eux et non sur l’un d’eux', async ({ page }) => {
  await ouvrir(page)
  await expect(page.getByRole('button', { name: /^Nouvelle section avant/ })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Nouvelle section avant Page de titre' })).toHaveCount(1)
  // Dix sections : neuf intervalles.
  await expect(page.getByRole('button', { name: /^Nouvelle section entre/ })).toHaveCount(9)
  // Entre deux doubles pages, le « + » est dans l'espace qui les sépare, hors des deux post-its.
  const plus = await page.getByRole('button', { name: 'Nouvelle section entre Page de titre et Avant-propos' }).boundingBox()
  const gauche = await postit(page, 'Page de titre').boundingBox()
  const droite = await postit(page, 'Avant-propos').boundingBox()
  if (!plus || !gauche || !droite) throw new Error('invisible')
  if (Math.abs(gauche.y - droite.y) < 5) {
    expect(plus.x).toBeGreaterThanOrEqual(gauche.x + gauche.width)
    expect(plus.x + plus.width).toBeLessThanOrEqual(droite.x)
  }
  // Rien ne déborde à droite de l'écran.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

  await page.getByRole('button', { name: 'Nouvelle section entre Créer son personnage et Le heurt' }).click()
  const dialogue = page.getByRole('dialog', { name: 'Nouvelle section' })
  await dialogue.getByLabel('Hors-texte').check()
  await dialogue.getByLabel('Titre', { exact: true }).fill('Fiche de personnage')
  await dialogue.getByRole('button', { name: 'Créer', exact: true }).click()
  await expect(titres(page).nth(4)).toHaveText('Fiche de personnage')
  await expect(titres(page).nth(5)).toHaveText('Le heurt')
})

test('modifier une section renomme son fichier sur GitHub', async ({ page }) => {
  const { faux } = await ouvrir(page)
  await page.getByRole('button', { name: 'Modifier Le heurt' }).click()
  const dialogue = page.getByRole('dialog', { name: 'Section' })
  await dialogue.getByLabel('Titre', { exact: true }).fill('Le choc')
  await dialogue.getByLabel('Statut', { exact: true }).selectOption('relu')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  const choc = postit(page, 'Le choc')
  await expect(choc).toHaveClass(/statut-relu/)

  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  const fichiers = faux.fichiers()
  expect(fichiers['sections/le-choc.md']).toBe(lireExemple()['sections/le-heurt.md'])
  expect(fichiers['sections/le-heurt.md']).toBeUndefined()
})

test('supprimer envoie à la corbeille ; « Annuler » la remet en place', async ({ page }) => {
  await ouvrir(page)
  await page.getByRole('button', { name: 'Modifier Le heurt' }).click()
  await page.getByRole('button', { name: 'Supprimer' }).click()
  await expect(titres(page)).toHaveText(sauf(TITRES, 'Le heurt'))
  await expect(page.locator('.bandeau-flottant')).toContainText('Section supprimée.')
  await expect(page.getByRole('button', { name: 'Corbeille (1)' })).toBeVisible()

  await page.locator('.bandeau-flottant').getByRole('button', { name: 'Annuler' }).click()
  await expect(titres(page)).toHaveText(TITRES)
  await expect(page.locator('.bandeau-flottant')).toHaveCount(0)
})

test('la corbeille restaure à la position d’origine et se vide avec confirmation', async ({ page }) => {
  const { faux } = await ouvrir(page)
  await page.getByRole('button', { name: 'Modifier Lexique' }).click()
  await page.getByRole('button', { name: 'Supprimer' }).click()
  await page.getByRole('button', { name: 'Modifier Avant-propos' }).click()
  await page.getByRole('button', { name: 'Supprimer' }).click()

  await page.getByRole('button', { name: 'Corbeille (2)' }).click()
  const corbeille = page.getByRole('dialog', { name: 'Corbeille' })
  await expect(corbeille.locator('.corbeille-titre')).toHaveText(['Avant-propos', 'Lexique'])
  await corbeille.getByRole('button', { name: 'Restaurer' }).first().click()
  await expect(titres(page)).toHaveText(sauf(TITRES, 'Lexique'))

  page.once('dialog', (d) => void d.accept())
  await corbeille.getByRole('button', { name: 'Vider la corbeille' }).click()
  await expect(corbeille.getByText('La corbeille est vide.')).toBeVisible()

  await expect(etat(page)).toHaveText('Synchronisé', { timeout: 15_000 })
  const fichiers = faux.fichiers()
  expect(fichiers['sections/lexique.md']).toBeUndefined()
  expect(fichiers['corbeille/lexique.md']).toBeUndefined()
  expect(fichiers['sections/avant-propos.md']).toBe(lireExemple()['sections/avant-propos.md'])
})

test('une modification survit à un rechargement avant l’envoi', async ({ page }) => {
  const { faux } = await ouvrir(page)
  const reseau = await brancherFauxGitHub(page, faux)
  reseau.couper(true)
  await page.getByRole('button', { name: 'Une page de plus pour Lexique' }).click()
  await expect(postit(page, 'Lexique').locator('.postit-pages')).toContainText('3 p.')
  await page.waitForTimeout(300)
  await page.reload()
  await expect(postit(page, 'Lexique').locator('.postit-pages')).toContainText('3 p.')
  await expect(etat(page)).toContainText('Hors ligne, 1 modification en attente')

  reseau.couper(false)
  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(etat(page)).toHaveText('Synchronisé')
  expect(lirePlan(faux.fichiers()['plan.json'] ?? '').sections.at(-1)?.pages).toBe(3)
})

test('pas de nombre de pages imposé : la grille suit les sections, l’impression arrondit à 4', async ({ page }) => {
  await ouvrir(page)
  await expect(page.locator('.barre-etat')).toContainText('Pages 19')
  await expect(page.locator('.page')).toHaveCount(19)
  await expect(page.locator('.alerte-pages')).toHaveText('Impression : 20 pages')
  await page.getByRole('button', { name: 'Réglages', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('Nombre de pages')).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click()
  await postit(page, 'Lexique').getByRole('button', { name: 'Une page de plus pour Lexique' }).click()
  await expect(page.locator('.barre-etat')).toContainText('Pages 20')
  await expect(page.locator('.alerte-pages')).toHaveCount(0)
})

test.describe('zoom', () => {
  test.skip(({ isMobile }) => isMobile, 'zoom : ordinateur seulement')

  test('le mode compact masque le résumé', async ({ page }) => {
    await ouvrir(page)
    await expect(page.locator('.postit-resume').first()).toBeVisible()
    await page.getByRole('button', { name: 'Compact' }).click()
    await expect(page.locator('.postit-resume').first()).toBeHidden()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
  })
})

test('plan modifié ailleurs pendant les modifications ici : fusion annoncée', async ({ page }) => {
  const { faux } = await ouvrir(page)
  const exemple = lireExemple()
  const ailleurs = JSON.parse(exemple['plan.json'] ?? '') as { livre: { titre: string } }
  ailleurs.livre.titre = 'Katastrophê (iPad)'
  await faux.publier({ ...exemple, 'plan.json': JSON.stringify(ailleurs, null, 2) + '\n' })

  await page.getByRole('button', { name: 'Une page de plus pour Lexique' }).click()
  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(page.locator('.bandeau-fusion')).toContainText('les deux versions ont été fusionnées')
  await expect(etat(page)).toHaveText('Synchronisé')
  const plan = lirePlan(faux.fichiers()['plan.json'] ?? '')
  expect(plan.livre.titre).toBe('Katastrophê (iPad)')
  expect(plan.sections.at(-1)?.pages).toBe(3)
  await page.getByRole('button', { name: 'Compris' }).click()
  await expect(page.locator('.bandeau-fusion')).toHaveCount(0)
})
