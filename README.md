# 🎨 MiniaStudio

**Le site : https://benjpro-cp.github.io/miniastudio/**

Tu écris le titre de ta vidéo, MiniaStudio te propose des miniatures YouTube dans la direction artistique (DA) de ta chaîne, avec ton visage si tu veux. Tu les notes (👎 👍 ❤️ 🏆), et il apprend tes goûts : **plus tu l'utilises, plus il colle à ta DA.**

Le site fonctionne **entièrement dans ton navigateur** : il n'y a pas de serveur. Tes images, ta DA et ta clé API restent sur ton appareil. Ta clé n'est envoyée qu'à Google (ou au fournisseur d'IA que tu choisis).

---

## Démarrer (5 minutes)

1. Ouvre le lien du site sur ton ordinateur, dans Chrome ou Edge de préférence.
2. **⚙️ Réglages** → clique sur **« ⭐ Gemini gratuit »**.
3. Sur la ligne « Google Cloud (express) », clique sur **« Obtenir ↗ »**, puis sur le bouton **« Accéder au mode Express »** de la page Google. Connecte-toi avec ton compte Gmail : ta clé est créée automatiquement.
4. Colle la clé dans le site, puis clique sur **« 🔌 Tester la connexion »** (le test ne crée aucune image).
5. **🎨 Ma DA** : présente ta chaîne, ajoute 5 à 15 de tes meilleures miniatures (glisser-déposer, Ctrl+V ou liens YouTube) et 2 à 4 photos de toi, puis **« 🔍 Analyser ma DA »**.
6. **✨ Créer** : écris le titre de ta vidéo → « Créer mes miniatures ». Note-les, retouche la meilleure dans l'éditeur, puis **« ✅ C'est la bonne ! »** pour la télécharger en JPG 1280×720 (moins de 2 Mo, prête pour YouTube).

Tu peux tout essayer **sans clé** : le site démarre en mode démo (fausses images, mais tout le reste fonctionne).

---

## 📁 Un dossier par type de vidéo

Tu fais des vidéos GTA, des vidéos sur les films, sur l'histoire… ? Crée **un dossier par type de vidéo**, avec le menu 📁 en haut ou le bouton « ＋ Nouveau » de l'écran Créer.

- Chaque dossier a **ses propres miniatures de référence, sa propre DA et son propre apprentissage** : une miniature GTA ne ressemble pas à une miniature Histoire.
- Ton visage est commun à tous les dossiers.
- Pour créer une miniature GTA, choisis le dossier « GTA » (puce en haut du formulaire), puis écris ton titre.
- En créant un dossier, tu peux reprendre la DA d'un autre dossier comme point de départ.
- Tes anciennes données sont rangées dans le dossier « Général ». Tu peux le renommer avec ✏️.

---

## 🧩 La banque d'images de chaque dossier

Pour les vidéos où ce n'est pas toi qui apparais (GTA : ton perso, des voitures, des logos…), mets ces images dans **🎨 Ma DA → 🧩 Banque d'images** du dossier.

- **Glisse tes images** : l'IA les reconnaît et leur donne un nom, un type (personnage, véhicule, logo, lieu…) et une description. Tu peux tout corriger.
- **⭐ = toujours présent** dans les miniatures de ce dossier (par exemple ton personnage principal).
- À chaque miniature, **l'IA choisit elle-même** les éléments qui collent au titre, et Gemini reçoit leurs images pour les reproduire fidèlement.
- **Ce qui manque, Gemini le crée.** Tu peux aussi lui demander un élément (« une Lamborghini dorée vue de 3/4 ») avec « ✨ Créer l'élément » : il est rangé dans la banque pour les prochaines fois.
- « Me mettre dans la miniature » (écran Créer) est **mémorisé pour chaque dossier** : décoche-le pour GTA, laisse-le coché pour tes vlogs.
- Avec « Voir et modifier les idées avant », tu vois les éléments choisis pour chaque idée, et tu peux en ajouter ou en retirer.

---

## Gemini gratuit : comment ça marche

| Façon d'utiliser Gemini | Cerveau (analyse + idées) | Images |
|---|---|---|
| **Clé Google Cloud « mode express »** ⭐ | Gratuit pendant 90 jours | **Gratuit pendant 90 jours**, sans carte bancaire (dans la limite des quotas) |
| Clé AI Studio (aistudio.google.com) | Gratuit, sans limite de durée | Payant : ≈ 0,03 à 0,05 $ par image (facturation à activer) |

- L'essai gratuit Google Cloud est réservé aux comptes Gmail **qui n'ont jamais utilisé Google Cloud**. Sinon, Google demande d'activer la facturation (≈ 0,04 $ par image).
- Si tu vois « trop de demandes », attends une minute : les quotas gratuits sont limités.
- Après 90 jours : active la facturation, ou passe sur « 🔵 Gemini (clé AI Studio) » pour garder le cerveau gratuit et payer seulement les images.
- Contrepartie des offres gratuites : Google peut utiliser ce que tu lui envoies pour améliorer ses produits.

---

## Comment il apprend ta DA

- L'analyse de tes miniatures de référence donne une DA de départ : palette, police, composition, cadrage, éclairage, règles du texte, ce qu'il faut éviter. Tout est modifiable.
- Chaque création utilise ta DA, tes préférences apprises, tes miniatures adorées (en exemples), celles que tu as rejetées (en contre-exemples) et tes miniatures ⭐ comme modèles de style.
- **Toutes les 5 notes**, l'IA relit tes retours et met à jour ta DA (avec historique et retour en arrière possible).

---

## Tes données

Tout est enregistré **dans ce navigateur, sur cet appareil**. Conséquences :

- Sur un autre appareil (ou un autre navigateur), le site s'ouvre vide.
- Si tu effaces les données de navigation de ce site, tu perds ta DA et tes images.

👉 Dans **⚙️ Réglages → Tes données**, utilise **« 💾 Sauvegarder mes données »** de temps en temps, et **« 📂 Restaurer une sauvegarde »** pour tout retrouver sur un autre appareil. La sauvegarde contient ta DA, tes références, tes photos et tes miniatures finales. Elle ne contient pas tes clés API : il faudra les recoller.

---

## Problèmes fréquents

| Problème | Solution |
|---|---|
| « refuse la clé API » | Vérifie que la clé est copiée en entier. |
| « essai gratuit terminé » | Les 90 jours sont passés : active la facturation Google Cloud, ou passe sur « 🔵 Gemini (clé AI Studio) ». |
| « pas inclus dans l'offre gratuite » | Tu crées des images avec une clé AI Studio : prends plutôt la clé Google Cloud « mode express ». |
| « trop de demandes » | Limite par minute de l'offre gratuite : attends une minute. |
| « Impossible de joindre… » | Vérifie ta connexion. Les autres fournisseurs (Grok, OpenAI…) peuvent refuser les appels venant d'une page web : Gemini, lui, les accepte. |
| Le site s'ouvre vide | Tu es sur un autre appareil ou navigateur : restaure ta sauvegarde. |
| Les réglages de luminosité ne marchent pas | Utilise Chrome ou Edge. |

---

## Pour les curieux

- `js/backend/` : la logique du site, qui tourne dans le navigateur (stockage IndexedDB, appels à Gemini, apprentissage de la DA).
- `js/backend/prompts.js` : les consignes données à l'IA (le savoir-faire miniature).
- `js/app.js`, `js/editor.js`, `js/render.js` : l'interface, l'éditeur et le rendu du texte sur les miniatures.
- Les polices incluses sont libres (licences dans `fonts/LICENCES-POLICES.txt`).
