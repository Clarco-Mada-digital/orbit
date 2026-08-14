#!/bin/bash

echo "🚀 Lancement d'Orbit..."

# Tuer les processus existants
pkill -f vite 2>/dev/null
pkill -f electron 2>/dev/null

# Démarrer Vite en arrière-plan
echo "📦 Démarrage du serveur React (Vite)..."
npm run dev &
VITE_PID=$!

# Attendre que Vite soit prêt
echo "⏳ Attente du serveur..."
sleep 3

# Vérifier si le serveur est prêt
while ! curl -s http://localhost:5173 > /dev/null; do
  echo "⏳ Serveur pas encore prêt..."
  sleep 1
done

echo "✅ Serveur React prêt!"

# Lancer Electron
echo "🖥️  Lancement d'Electron..."
npx electron .

# Cleanup
echo "🧹 Nettoyage..."
kill $VITE_PID 2>/dev/null
