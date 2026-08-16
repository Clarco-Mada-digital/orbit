import { Component } from 'react';

// Filet de sécurité global : si un composant React lève une exception, on
// affiche un écran de récupération au lieu d'un écran blanc total. Les données
// (profils, apps, sessions) restent intactes — un rechargement suffit.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Trace utile pour le diagnostic (visible dans les DevTools / logs).
    console.error('[orbit] erreur non gérée dans l’interface', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-bg-base text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-error/15 flex items-center justify-center text-3xl">
          ⚠️
        </div>
        <div className="max-w-md">
          <h1 className="text-xl font-bold mb-2">Une erreur est survenue</h1>
          <p className="text-sm text-text-muted">
            L’interface a rencontré un problème inattendu. Vos profils, applications et sessions
            sont intacts — un rechargement règle généralement la situation.
          </p>
          {this.state.error?.message && (
            <p className="text-xs text-text-muted mt-3 font-mono break-words opacity-70">
              {String(this.state.error.message)}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.location.reload()} className="btn btn-primary">
            Recharger l’application
          </button>
          <button onClick={() => this.setState({ error: null })} className="btn btn-secondary">
            Réessayer
          </button>
        </div>
      </div>
    );
  }
}
