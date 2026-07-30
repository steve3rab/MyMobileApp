# MyMobileApp

Ébauche d'une application mobile web modulaire.

## Fonctionnalités disponibles

- suivi des revenus et dépenses par mois ;
- ajout et suppression d'opérations ;
- budget global mensuel ;
- thème clair/sombre ;
- stockage local avec `localStorage` ;
- export et import d'une sauvegarde JSON ;
- interface mobile compatible iPhone.

## Utilisation sur iPhone

1. Décompresser l'archive.
2. Ouvrir `index.html` dans un éditeur ou un hébergement statique.
3. Pour une utilisation simple sans serveur, le stockage local fonctionne dans le navigateur.
4. Pour l'installation comme PWA, placer le dossier sur un hébergement HTTPS statique.

## Évolution prévue

L'architecture peut ensuite accueillir d'autres modules :
- listes de courses ;
- tâches ;
- stock ;
- véhicule ;
- facturation ;
- statistiques avancées.

La prochaine étape recommandée est le remplacement de `localStorage` par IndexedDB et l'ajout d'un véritable système de modules.
