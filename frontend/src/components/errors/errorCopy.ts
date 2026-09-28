/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { I18nMessage } from "../../i18n";
import type { ApplicationErrorKind } from "../../utils/applicationError";

type ErrorCopy = {
  label: I18nMessage;
  title: I18nMessage;
  description: I18nMessage;
  illustration: "lost" | "access" | "connection";
  tone: "info" | "warning" | "danger" | "neutral";
};
const message = (en: string, fr: string): I18nMessage => ({ en, fr });

export const errorCopy: Record<ApplicationErrorKind, ErrorCopy> = {
  not_found: {
    label: message("Page not found", "Page introuvable"),
    title: message("This page has drifted away.", "Cette page a pris le large."),
    description: message("The link may have changed, or this page no longer exists. Let’s find your way back.", "Le lien a peut-être changé, ou cette page n’existe plus. Retrouvons votre chemin."),
    illustration: "lost", tone: "info",
  },
  gone: {
    label: message("Resource unavailable", "Ressource indisponible"),
    title: message("This resource is no longer here.", "Cette ressource n’est plus disponible."),
    description: message("This resource has been removed. Return to your workspace to continue.", "Cette ressource a été retirée. Revenez à votre espace pour continuer."),
    illustration: "lost", tone: "neutral",
  },
  sign_in: {
    label: message("Sign-in required", "Connexion requise"),
    title: message("Let’s get acquainted.", "Faisons connaissance."),
    description: message("Sign in to open this page.", "Connectez-vous pour ouvrir cette page."),
    illustration: "access", tone: "info",
  },
  session_expired: {
    label: message("Session ended", "Session terminée"),
    title: message("Let’s pick up where we left off.", "Reprenons le fil."),
    description: message("Your session is no longer valid. Sign in again to continue.", "Votre session n’est plus valide. Reconnectez-vous pour continuer."),
    illustration: "access", tone: "info",
  },
  forbidden: {
    label: message("Access restricted", "Accès restreint"),
    title: message("This passage is reserved.", "Ce passage est réservé."),
    description: message("Your account does not have access to this page. Contact your administrator if you need it.", "Votre compte n’a pas accès à cette page. Contactez votre administrateur si vous en avez besoin."),
    illustration: "access", tone: "warning",
  },
  verification_required: {
    label: message("Verification required", "Vérification requise"),
    title: message("One more check before continuing.", "Une vérification avant de continuer."),
    description: message("Verify your identity with a passkey in your security settings, then return to this page.", "Vérifiez votre identité avec une passkey dans vos paramètres de sécurité, puis revenez sur cette page."),
    illustration: "access", tone: "warning",
  },
  invalid_link: {
    label: message("Invalid link", "Lien invalide"),
    title: message("This link is off course.", "Ce lien ne mène pas à bon port."),
    description: message("The link is incomplete or invalid. Open the complete link, or return to your workspace.", "Le lien est incomplet ou invalide. Ouvrez le lien complet ou revenez à votre espace."),
    illustration: "lost", tone: "info",
  },
  link_expired: {
    label: message("Link expired", "Lien expiré"),
    title: message("This link has finished its journey.", "Ce lien a terminé son voyage."),
    description: message("This link is no longer valid. Ask the person who shared it for a new one.", "Ce lien n’est plus valide. Demandez un nouveau lien à la personne qui vous l’a transmis."),
    illustration: "lost", tone: "neutral",
  },
  auth_failed: {
    label: message("Sign-in unsuccessful", "Connexion non aboutie"),
    title: message("We couldn’t complete your sign-in.", "La connexion n’a pas pu aboutir."),
    description: message("Return to sign in and start again. If the problem persists, contact your administrator.", "Revenez à la connexion pour recommencer. Si le problème persiste, contactez votre administrateur."),
    illustration: "access", tone: "warning",
  },
  unexpected: {
    label: message("Unexpected error", "Erreur inattendue"),
    title: message("A little turbulence in the reef.", "Un imprévu dans le récif."),
    description: message("This page could not be loaded. Try loading it again, or return to your workspace.", "Cette page n’a pas pu être chargée. Réessayez de la charger ou revenez à votre espace."),
    illustration: "connection", tone: "danger",
  },
  unavailable: {
    label: message("Service unavailable", "Service indisponible"),
    title: message("A small setback under the sea.", "Un petit contretemps sous l’eau."),
    description: message("The service cannot be reached right now. Try again in a few moments.", "Le service est injoignable pour le moment. Réessayez dans quelques instants."),
    illustration: "connection", tone: "danger",
  },
  timeout: {
    label: message("Response timed out", "Délai de réponse dépassé"),
    title: message("The reply is taking its time.", "La réponse se fait attendre."),
    description: message("The service did not respond in time. You can try loading this page again.", "Le service n’a pas répondu à temps. Vous pouvez réessayer de charger cette page."),
    illustration: "connection", tone: "warning",
  },
  offline: {
    label: message("You’re offline", "Connexion réseau absente"),
    title: message("The surface is out of reach.", "Le contact avec la surface est coupé."),
    description: message("Check your internet or local network connection, then try again.", "Vérifiez votre connexion Internet ou au réseau local, puis réessayez."),
    illustration: "connection", tone: "warning",
  },
  rate_limited: {
    label: message("A short pause", "Une courte pause"),
    title: message("Let the current settle.", "Laissons passer le courant."),
    description: message("Too many requests arrived at once. Wait a little before trying again.", "Trop de demandes sont arrivées à la fois. Patientez un peu avant de réessayer."),
    illustration: "connection", tone: "warning",
  },
  maintenance: {
    label: message("Scheduled maintenance", "Maintenance annoncée"),
    title: message("A short technical stopover.", "Petite escale technique."),
    description: message("This service is undergoing maintenance. Please check back later.", "Ce service est en cours de maintenance. Réessayez ultérieurement."),
    illustration: "connection", tone: "neutral",
  },
  feature_disabled: {
    label: message("Feature disabled", "Fonction désactivée"),
    title: message("This passage is closed for now.", "Ce passage est fermé pour le moment."),
    description: message("This feature is disabled. Contact your administrator if you need access.", "Cette fonction est désactivée. Contactez votre administrateur si vous en avez besoin."),
    illustration: "access", tone: "neutral",
  },
  unsupported: {
    label: message("Not supported", "Fonction non prise en charge"),
    title: message("This stop isn’t available here.", "Cette escale n’est pas disponible ici."),
    description: message("The selected service does not support this feature. Return to your workspace to continue.", "Le service sélectionné ne prend pas en charge cette fonction. Revenez à votre espace pour continuer."),
    illustration: "access", tone: "neutral",
  },
  validation: {
    label: message("Request not accepted", "Demande non acceptée"),
    title: message("Let’s check the coordinates.", "Vérifions les coordonnées."),
    description: message("Some information is missing or invalid. Return to the previous page to review it.", "Certaines informations sont manquantes ou invalides. Revenez à la page précédente pour les vérifier."),
    illustration: "lost", tone: "warning",
  },
  conflict: {
    label: message("Information has changed", "Informations modifiées"),
    title: message("The current has shifted.", "Le courant a changé."),
    description: message("The resource has changed or cannot accept this operation. Check its current state before trying again.", "La ressource a changé ou ne peut pas accepter cette opération. Vérifiez son état avant de recommencer."),
    illustration: "lost", tone: "warning",
  },
  too_large: {
    label: message("Size limit reached", "Limite de taille atteinte"),
    title: message("A little too much for this crossing.", "Un peu trop pour cette traversée."),
    description: message("This request exceeds the accepted size. Return to the previous page and reduce its size.", "Cette demande dépasse la taille acceptée. Revenez à la page précédente pour la réduire."),
    illustration: "lost", tone: "warning",
  },
  quota: {
    label: message("Capacity unavailable", "Capacité indisponible"),
    title: message("There isn’t enough room here.", "L’espace disponible est insuffisant."),
    description: message("The service cannot store this request. Check capacity with your administrator before trying again.", "Le service ne peut pas stocker cette demande. Vérifiez la capacité avec votre administrateur avant de recommencer."),
    illustration: "connection", tone: "warning",
  },
};

export const errorActions = {
  home: message("Back to workspace", "Revenir à mon espace"),
  login: message("Go to sign in", "Se connecter"),
  reconnect: message("Sign in again", "Se reconnecter"),
  switchAccount: message("Switch account", "Changer de compte"),
  retry: message("Retry", "Réessayer"),
  security: message("Security settings", "Paramètres de sécurité"),
  previous: message("Previous page", "Page précédente"),
  details: message("Technical details", "Détails techniques"),
  copy: message("Copy details", "Copier les détails"),
  copied: message("Details copied", "Détails copiés"),
  copyFailed: message("Copy unavailable. Select the details to copy them.", "Copie indisponible. Sélectionnez les détails pour les copier."),
  time: message("Observed at", "Constaté le"),
  reference: message("Reference", "Référence"),
  category: message("Category", "Catégorie"),
  wait: message("Retry available in", "Nouvelle tentative dans"),
  support: message("If the problem persists, contact your administrator.", "Si le problème persiste, contactez votre administrateur."),
};
