# nicolabz UI — thème clair/sombre

Prototype HTML/CSS/JS sans framework ni dépendances externes.

## Démarrer

Ouvrir `index.html` dans le navigateur, ou servir le dossier avec `python -m http.server 8080`.

## Organisation

- `palette.json` : palette source **documentaire** des deux thèmes, indépendante de toute application.
- `css/theme.css` : tokens CSS sémantiques utilisés à l'exécution.
- `css/components.css` : mise en page et composants de cette démo uniquement.
- `js/theme.js` : thème actif, préférence système, bouton et stockage local.

**Important :** pour ce premier POC, `palette.json` et `css/theme.css` sont synchronisés manuellement. Modifier le JSON ne régénère PAS automatiquement les variables CSS. Une prochaine étape pourra introduire un petit script de génération et un package versionné pour éviter deux sources de vérité.

## Réutiliser dans une application

1. Copier `css/theme.css` dans l'application ou l'importer depuis un package partagé.
2. Placer `data-theme="light"` ou `data-theme="dark"` sur l'élément `<html>`.
3. Utiliser les tokens : `background: var(--color-background); color: var(--color-text); border-color: var(--color-border);`.
4. Réutiliser ou adapter `js/theme.js` pour basculer le thème (le sélecteur attend un bouton `data-theme-toggle`).

## Accessibilité et comportement

- Le thème initial suit la préférence du système si aucun choix n'est enregistré.
- Le choix explicite est mémorisé via `localStorage` et reste fonctionnel même si celui-ci est indisponible.
- Le thème choisi est appliqué sur `<html>` et les composants lisent les tokens sémantiques.
- Les animations respectent `prefers-reduced-motion`.
- La forme multicolore est décorative, réalisée en CSS, sans image. Elle est attachée au fond global (`.page-shell`) et reste derrière le `header`, le `main` et le `footer` grâce à des couches explicites (`z-index`).

## Limites

- Les couleurs sombres sont une **interprétation** du langage visuel de nicolabz.dev, pas une extraction fidèle de son code source CSS.
- Le formulaire est une démonstration locale sans backend.
- Aucune suite de tests navigateurs ou audit d'accessibilité complet n'est fournie.

## Position de la forme colorée

La forme est centrée dans le fond global via `.spectrum-art` (`left: 50%` et `transform: translateX(-50%)`). Pour la déplacer verticalement, modifier `top` dans `css/components.css`, y compris la règle mobile. Elle reste sous les textes et les composants grâce aux couches définies sur `.page-shell`.
