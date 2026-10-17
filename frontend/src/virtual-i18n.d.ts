type BucketReefI18nCatalog = Readonly<Record<string, string>>;

type BucketReefI18nCatalogs = Readonly<{
  fr: BucketReefI18nCatalog;
  de: BucketReefI18nCatalog;
  zh: BucketReefI18nCatalog;
}>;

declare module "bucketreef-i18n/admin" {
  const catalogs: BucketReefI18nCatalogs;
  export default catalogs;
}

declare module "bucketreef-i18n/browser" {
  const catalogs: BucketReefI18nCatalogs;
  export default catalogs;
}

declare module "bucketreef-i18n/cephAdmin" {
  const catalogs: BucketReefI18nCatalogs;
  export default catalogs;
}

declare module "bucketreef-i18n/manager" {
  const catalogs: BucketReefI18nCatalogs;
  export default catalogs;
}

declare module "bucketreef-i18n/shared" {
  const catalogs: BucketReefI18nCatalogs;
  export default catalogs;
}
