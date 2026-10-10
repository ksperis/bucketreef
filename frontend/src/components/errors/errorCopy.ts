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
const message = (en: string, fr: string, zh: string): I18nMessage => ({ en, fr, zh });

export const errorCopy: Record<ApplicationErrorKind, ErrorCopy> = {
  not_found: {
    label: message("Page not found", "Page introuvable", "页面未找到"),
    title: message("This page has drifted away.", "Cette page a pris le large.", "此页面已不见踪影。"),
    description: message("The link may have changed, or this page no longer exists. Let’s find your way back.", "Le lien a peut-être changé, ou cette page n’existe plus. Retrouvons votre chemin.", "链接可能已更改，或此页面已不存在。让我们带你回去。"),
    illustration: "lost", tone: "info",
  },
  gone: {
    label: message("Resource unavailable", "Ressource indisponible", "资源不可用"),
    title: message("This resource is no longer here.", "Cette ressource n’est plus disponible.", "此资源已不存在。"),
    description: message("This resource has been removed. Return to your workspace to continue.", "Cette ressource a été retirée. Revenez à votre espace pour continuer.", "此资源已被移除。返回工作区以继续。"),
    illustration: "lost", tone: "neutral",
  },
  sign_in: {
    label: message("Sign-in required", "Connexion requise", "需要登录"),
    title: message("Let’s get acquainted.", "Faisons connaissance.", "请先登录。"),
    description: message("Sign in to open this page.", "Connectez-vous pour ouvrir cette page.", "登录后才能打开此页面。"),
    illustration: "access", tone: "info",
  },
  session_expired: {
    label: message("Session ended", "Session terminée", "会话已结束"),
    title: message("Let’s pick up where we left off.", "Reprenons le fil.", "从上次中断处继续。"),
    description: message("Your session is no longer valid. Sign in again to continue.", "Votre session n’est plus valide. Reconnectez-vous pour continuer.", "当前会话已失效。请重新登录以继续。"),
    illustration: "access", tone: "info",
  },
  forbidden: {
    label: message("Access restricted", "Accès restreint", "访问受限"),
    title: message("This passage is reserved.", "Ce passage est réservé.", "此区域仅限授权访问。"),
    description: message("Your account does not have access to this page. Contact your administrator if you need it.", "Votre compte n’a pas accès à cette page. Contactez votre administrateur si vous en avez besoin.", "你的账户无权访问此页面。如需访问，请联系管理员。"),
    illustration: "access", tone: "warning",
  },
  verification_required: {
    label: message("Verification required", "Vérification requise", "需要验证"),
    title: message("One more check before continuing.", "Une vérification avant de continuer.", "继续前还需进行一次验证。"),
    description: message("Verify your identity with a passkey in your security settings, then return to this page.", "Vérifiez votre identité avec une passkey dans vos paramètres de sécurité, puis revenez sur cette page.", "请在安全设置中使用通行密钥验证身份，然后返回此页面。"),
    illustration: "access", tone: "warning",
  },
  invalid_link: {
    label: message("Invalid link", "Lien invalide", "链接无效"),
    title: message("This link is off course.", "Ce lien ne mène pas à bon port.", "此链接无法使用。"),
    description: message("The link is incomplete or invalid. Open the complete link, or return to your workspace.", "Le lien est incomplet ou invalide. Ouvrez le lien complet ou revenez à votre espace.", "链接不完整或无效。请打开完整链接，或返回工作区。"),
    illustration: "lost", tone: "info",
  },
  link_expired: {
    label: message("Link expired", "Lien expiré", "链接已过期"),
    title: message("This link has finished its journey.", "Ce lien a terminé son voyage.", "此链接已失效。"),
    description: message("This link is no longer valid. Ask the person who shared it for a new one.", "Ce lien n’est plus valide. Demandez un nouveau lien à la personne qui vous l’a transmis.", "此链接已不再有效。请向分享者索取新链接。"),
    illustration: "lost", tone: "neutral",
  },
  auth_failed: {
    label: message("Sign-in unsuccessful", "Connexion non aboutie", "登录未成功"),
    title: message("We couldn’t complete your sign-in.", "La connexion n’a pas pu aboutir.", "无法完成登录。"),
    description: message("Return to sign in and start again. If the problem persists, contact your administrator.", "Revenez à la connexion pour recommencer. Si le problème persiste, contactez votre administrateur.", "返回登录页面并重新开始。如果问题仍然存在，请联系管理员。"),
    illustration: "access", tone: "warning",
  },
  unexpected: {
    label: message("Unexpected error", "Erreur inattendue", "意外错误"),
    title: message("A little turbulence in the reef.", "Un imprévu dans le récif.", "礁区出现了一点波动。"),
    description: message("This page could not be loaded. Try loading it again, or return to your workspace.", "Cette page n’a pas pu être chargée. Réessayez de la charger ou revenez à votre espace.", "此页面无法加载。请重新加载，或返回工作区。"),
    illustration: "connection", tone: "danger",
  },
  unavailable: {
    label: message("Service unavailable", "Service indisponible", "服务不可用"),
    title: message("A small setback under the sea.", "Un petit contretemps sous l’eau.", "海底遇到了一点小状况。"),
    description: message("The service cannot be reached right now. Try again in a few moments.", "Le service est injoignable pour le moment. Réessayez dans quelques instants.", "当前无法访问服务。请稍后重试。"),
    illustration: "connection", tone: "danger",
  },
  timeout: {
    label: message("Response timed out", "Délai de réponse dépassé", "响应超时"),
    title: message("The reply is taking its time.", "La réponse se fait attendre.", "响应还需要一点时间。"),
    description: message("The service did not respond in time. You can try loading this page again.", "Le service n’a pas répondu à temps. Vous pouvez réessayer de charger cette page.", "服务未能及时响应。你可以重新加载此页面。"),
    illustration: "connection", tone: "warning",
  },
  offline: {
    label: message("You’re offline", "Connexion réseau absente", "你已离线"),
    title: message("The surface is out of reach.", "Le contact avec la surface est coupé.", "无法连接到网络。"),
    description: message("Check your internet or local network connection, then try again.", "Vérifiez votre connexion Internet ou au réseau local, puis réessayez.", "请检查互联网或本地网络连接，然后重试。"),
    illustration: "connection", tone: "warning",
  },
  rate_limited: {
    label: message("A short pause", "Une courte pause", "暂停片刻"),
    title: message("Let the current settle.", "Laissons passer le courant.", "请稍等片刻。"),
    description: message("Too many requests arrived at once. Wait a little before trying again.", "Trop de demandes sont arrivées à la fois. Patientez un peu avant de réessayer.", "请求过于频繁。请稍等后再试。"),
    illustration: "connection", tone: "warning",
  },
  maintenance: {
    label: message("Scheduled maintenance", "Maintenance annoncée", "计划维护"),
    title: message("A short technical stopover.", "Petite escale technique.", "短暂的技术维护。"),
    description: message("This service is undergoing maintenance. Please check back later.", "Ce service est en cours de maintenance. Réessayez ultérieurement.", "此服务正在维护。请稍后再回来。"),
    illustration: "connection", tone: "neutral",
  },
  feature_disabled: {
    label: message("Feature disabled", "Fonction désactivée", "功能已禁用"),
    title: message("This passage is closed for now.", "Ce passage est fermé pour le moment.", "此功能暂时关闭。"),
    description: message("This feature is disabled. Contact your administrator if you need access.", "Cette fonction est désactivée. Contactez votre administrateur si vous en avez besoin.", "此功能已禁用。如需访问，请联系管理员。"),
    illustration: "access", tone: "neutral",
  },
  unsupported: {
    label: message("Not supported", "Fonction non prise en charge", "不支持"),
    title: message("This stop isn’t available here.", "Cette escale n’est pas disponible ici.", "此处不支持此功能。"),
    description: message("The selected service does not support this feature. Return to your workspace to continue.", "Le service sélectionné ne prend pas en charge cette fonction. Revenez à votre espace pour continuer.", "所选服务不支持此功能。返回工作区以继续。"),
    illustration: "access", tone: "neutral",
  },
  validation: {
    label: message("Request not accepted", "Demande non acceptée", "请求未被接受"),
    title: message("Let’s check the coordinates.", "Vérifions les coordonnées.", "请检查相关信息。"),
    description: message("Some information is missing or invalid. Return to the previous page to review it.", "Certaines informations sont manquantes ou invalides. Revenez à la page précédente pour les vérifier.", "部分信息缺失或无效。请返回上一页进行检查。"),
    illustration: "lost", tone: "warning",
  },
  conflict: {
    label: message("Information has changed", "Informations modifiées", "信息已更改"),
    title: message("The current has shifted.", "Le courant a changé.", "当前状态已变化。"),
    description: message("The resource has changed or cannot accept this operation. Check its current state before trying again.", "La ressource a changé ou ne peut pas accepter cette opération. Vérifiez son état avant de recommencer.", "资源已发生变化或无法接受此操作。请检查其当前状态后重试。"),
    illustration: "lost", tone: "warning",
  },
  too_large: {
    label: message("Size limit reached", "Limite de taille atteinte", "已达到大小限制"),
    title: message("A little too much for this crossing.", "Un peu trop pour cette traversée.", "此次请求超出了可接受范围。"),
    description: message("This request exceeds the accepted size. Return to the previous page and reduce its size.", "Cette demande dépasse la taille acceptée. Revenez à la page précédente pour la réduire.", "此请求超过了允许的大小。请返回上一页并减小其大小。"),
    illustration: "lost", tone: "warning",
  },
  quota: {
    label: message("Capacity unavailable", "Capacité indisponible", "容量不可用"),
    title: message("There isn’t enough room here.", "L’espace disponible est insuffisant.", "可用空间不足。"),
    description: message("The service cannot store this request. Check capacity with your administrator before trying again.", "Le service ne peut pas stocker cette demande. Vérifiez la capacité avec votre administrateur avant de recommencer.", "服务无法存储此请求。请联系管理员确认容量后重试。"),
    illustration: "connection", tone: "warning",
  },
};

export const errorActions = {
  home: message("Back to workspace", "Revenir à mon espace", "返回工作区"),
  login: message("Go to sign in", "Se connecter", "前往登录"),
  reconnect: message("Sign in again", "Se reconnecter", "重新登录"),
  switchAccount: message("Switch account", "Changer de compte", "切换账户"),
  retry: message("Retry", "Réessayer", "重试"),
  security: message("Security settings", "Paramètres de sécurité", "安全设置"),
  previous: message("Previous page", "Page précédente", "上一页"),
  details: message("Technical details", "Détails techniques", "技术详情"),
  copy: message("Copy details", "Copier les détails", "复制详情"),
  copied: message("Details copied", "Détails copiés", "详情已复制"),
  copyFailed: message("Copy unavailable. Select the details to copy them.", "Copie indisponible. Sélectionnez les détails pour les copier.", "无法复制。请选择详情后手动复制。"),
  time: message("Observed at", "Constaté le", "发生时间"),
  reference: message("Reference", "Référence", "参考编号"),
  category: message("Category", "Catégorie", "类别"),
  wait: message("Retry available in", "Nouvelle tentative dans", "可在以下时间后重试"),
  support: message("If the problem persists, contact your administrator.", "Si le problème persiste, contactez votre administrateur.", "如果问题仍然存在，请联系管理员。"),
};
