#!/usr/bin/env python3
"""Compile le manuscrit de Katastrophê en un seul fichier Markdown.

Produit exactement le même fichier que le bouton « Compiler » de l'Atelier,
octet pour octet, à partir d'un clone du dépôt du manuscrit. N'utilise que
la bibliothèque standard de Python 3.

Exemples, depuis la racine du dépôt du manuscrit :

    python3 outils/compiler.py                  # version suivante, dans compilations/
    python3 outils/compiler.py --version 27     # version imposée
    python3 outils/compiler.py --sans-vides     # sans les sections vides
    python3 outils/compiler.py --reperes        # avec les repères de pages
    python3 outils/compiler.py --sortie -       # sur la sortie standard

Toute modification du format doit être faite aussi dans l'Atelier
(src/domaine/compilation.ts) : un test vérifie que les deux sorties sont
identiques.
"""

import argparse
import json
import os
import re
import sys

MODELE_PAR_DEFAUT = "Katastrophe__v{n}.md"
TIRET_CADRATIN = chr(0x2014)
# Blancs : une section qui n'en contient que d'autres est vide.
BLANCS = set(" \t\n\r\f\v" + chr(0xA0) + chr(0x202F) + chr(0xFEFF))
ROMAINS = [
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
    (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
]


def en_romains(n):
    resultat = ""
    for valeur, symbole in ROMAINS:
        while n >= valeur:
            resultat += symbole
            n -= valeur
    return resultat


def numeros_des_parties(parties):
    numeros, n = {}, 0
    for partie in parties:
        if partie["numerotee"]:
            n += 1
            numeros[partie["id"]] = en_romains(n)
    return numeros


def cote_de_la_page(page, premiere_page):
    impaire = page % 2 == 1
    return "droite" if impaire == (premiere_page == "droite") else "gauche"


def paginer(sections, premiere_page):
    """Pages de chaque section, pages blanches comprises."""
    emplacements, page = {}, 1
    for s in sections:
        if s["debut"] != "indifferent" and cote_de_la_page(page, premiere_page) != s["debut"]:
            page += 1
        emplacements[s["id"]] = (page, page + s["pages"] - 1)
        page += s["pages"]
    return emplacements


def est_vide(texte):
    return all(c in BLANCS for c in texte)


def lire_texte(depot, chemin):
    """Texte exact du fichier ; un fichier absent compte pour un texte vide."""
    try:
        with open(os.path.join(depot, chemin), "rb") as f:
            return f.read().decode("utf-8")
    except FileNotFoundError:
        return ""


def compiler(plan, textes, sections_vides_incluses, reperes_pages):
    emplacements = paginer(plan["sections"], plan["livre"]["premierePage"])
    numeros = numeros_des_parties(plan["parties"])
    parties = {p["id"]: p for p in plan["parties"]}
    blocs, partie_precedente = [], None

    for s in plan["sections"]:
        premiere, derniere = emplacements[s["id"]]
        pages = str(premiere) if premiere == derniere else f"{premiere}-{derniere}"
        texte = textes.get(s["id"], "") if s["type"] == "texte" else ""
        if s["type"] == "texte" and not sections_vides_incluses and est_vide(texte):
            continue

        if s["partie"] != partie_precedente:
            titre = parties[s["partie"]]["titre"] if s["partie"] in parties else s["partie"]
            numero = numeros.get(s["partie"])
            blocs.append(f"# Partie {numero} {TIRET_CADRATIN} {titre}" if numero else f"# {titre}")
            partie_precedente = s["partie"]

        if s["type"] == "hors-texte":
            blocs.append(f"<!-- HORS-TEXTE : {s['titre']} (p. {pages}) -->")
            continue
        if s["type"] == "blanche":
            blocs.append(f"<!-- PAGE BLANCHE (p. {pages}) -->")
            continue
        tete = f"## {s['titre']}"
        if reperes_pages:
            tete += f"\n<!-- pages {pages} -->"
        corps = texte.rstrip("\r\n")
        blocs.append(tete if corps == "" else f"{tete}\n\n{corps}")

    return "\n\n".join(blocs) + "\n"


def version_suivante(modele, noms):
    avant, apres = modele.split("{n}", 1)
    motif = re.compile("^" + re.escape(avant) + r"(\d+)" + re.escape(apres) + "$")
    plus_haute = 0
    for nom in noms:
        m = motif.match(nom)
        if m:
            plus_haute = max(plus_haute, int(m.group(1)))
    return plus_haute + 1


def main():
    racine_par_defaut = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    lecteur = argparse.ArgumentParser(description="Compile le manuscrit en un seul fichier Markdown.")
    lecteur.add_argument("--depot", default=racine_par_defaut, help="racine du dépôt du manuscrit")
    lecteur.add_argument("--version", type=int, help="numéro de version (par défaut : le suivant)")
    lecteur.add_argument("--sans-vides", action="store_true", help="exclure les sections vides")
    lecteur.add_argument("--reperes", action="store_true", help="ajouter les repères de pages")
    lecteur.add_argument("--sortie", help="fichier de sortie, ou « - » pour la sortie standard")
    options = lecteur.parse_args()

    with open(os.path.join(options.depot, "plan.json"), "rb") as f:
        plan = json.loads(f.read().decode("utf-8"))
    textes = {s["id"]: lire_texte(options.depot, s["fichier"]) for s in plan["sections"] if s["type"] == "texte"}
    resultat = compiler(plan, textes, not options.sans_vides, options.reperes)
    octets = resultat.encode("utf-8")

    if options.sortie == "-":
        sys.stdout.buffer.write(octets)
        return

    dossier = os.path.join(options.depot, "compilations")
    modele = plan.get("reglages", {}).get("compilation", {}).get("modele", MODELE_PAR_DEFAUT)
    version = options.version
    if version is None:
        existants = os.listdir(dossier) if os.path.isdir(dossier) else []
        version = version_suivante(modele, existants)
    chemin = options.sortie or os.path.join(dossier, modele.replace("{n}", str(version)))
    os.makedirs(os.path.dirname(os.path.abspath(chemin)), exist_ok=True)
    with open(chemin, "wb") as f:
        f.write(octets)
    print(chemin)


if __name__ == "__main__":
    main()
