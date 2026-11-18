/** Locally curated English supplements. Only regular count nouns inherit
 * checklist's plural/possessive flags; irregular forms are listed explicitly. */
export const fieldVocabulary = {
  software: {
    nouns:
      "allocator bytecode compiler coroutine datastore deserializer endpoint enum filesystem formatter hashmap iterator microservice monorepo mutex namespace profiler runtime serializer submodule tokenizer toolchain tuple",
    exact:
      "asynchronous composable deduplication deserialization idempotent immutability memoization multithreaded observability serialization stateless transactional",
  },
  science: {
    nouns:
      "anisotropy autocorrelation bolometer calorimeter covariate eigenvalue eigenvector exoplanet fluorophore interferometer isotopologue micrograph nanometer photometer spectrogram spectrometer supercapacitor thermocouple waveguide",
    exact:
      "albedo anisotropic astrometric birefringence calorimetry heteroscedastic interferometry isotropic luminescence photometry stoichiometric spectrophotometry submillimeter",
  },
  law: {
    nouns:
      "affiant appellee appellant assignor counterclaim counterparty deponent grantor indemnitor interpleader lienholder mortgagor nonparty obligee obligor offeree offeror quitclaim sublease tortfeasor transferee",
    exact:
      "adjudicative amici amicus certiorari declaratory discoverability estoppel justiciability mandamus nondelegable nonprecedential preclusive promissory severability subrogation unenforceability",
  },
  medicine: {
    nouns:
      "audiogram bronchodilator cardiomyocyte comorbidity contraindication echocardiogram echocardiographer electrocardiogram endoscope glucometer immunoassay nephrologist oximeter spirometer vasodilator",
    exact:
      "bradycardia cardiopulmonary echocardiography hyperglycemia hypoglycemia hypoxemia intraoperative musculoskeletal neuropathic oximetry perioperative polypharmacy postoperative preoperative spirometry supraventricular tachycardia telehealth",
  },
  finance: {
    nouns:
      "acquirer annuitant chargeback custodian drawdown funder paydown prepayment receivable remittance underwriter",
    exact:
      "amortized cashless collateralized fintech illiquidity macroprudential securitization",
  },
  geography: {
    nouns:
      "basemap catchment contour geofence geoid geotag isochrone microclimate orthophoto raster shapefile transect",
    exact:
      "bathymetric geodetic geospatial geotechnical hydrographic hypsometric topographic",
  },
  education: {
    nouns:
      "capstone coursebook exemplar makerspace microcredential practicum rubric screencast",
    exact:
      "andragogy asynchronous constructivist metacognition metacognitive multimodal pedagogical phonemic",
  },
  music: {
    nouns:
      "arpeggiator downbeat drumbeat fader keyframe overdub polyrhythm soundscape spectrograph syncopation wavetable",
    exact:
      "antiphonal diatonic microtonal monophonic multitrack polyphonic polyrhythmic timbral",
  },
} as const;
