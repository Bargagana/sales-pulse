/** PRD §8 AC2 golden values for data/data.csv (rupiah, MoM % and scores to 1 decimal). */
export const GOLDEN = {
  regions: {
    Jabodetabek: 495_827_800,
    Sumatera: 340_690_500,
    'Jawa Barat': 310_947_300,
    'Jawa Tengah': 222_881_500,
    'Jawa Timur': 211_378_500,
    Kalimantan: 144_240_400,
  },
  brands: {
    'Kacang Dua Kelinci': 739_781_900,
    'Tos Tos': 285_909_300,
    Sukro: 271_738_100,
    'Tic Tac': 187_336_900,
    Deka: 91_197_500,
    Pilus: 71_659_900,
    Usagi: 43_943_200,
    Roni: 34_399_200,
  },
  peerMedians: { Grosir: -1.9, Warung: 7.3, 'Toko Kelontong': 14.5, Minimarket: -0.1 },
  weakest: [
    { outletId: 'OUT1022', name: 'Toko Bintang', outletType: 'Toko Kelontong', baseline: 8_764_300, current: 3_223_100, momPct: -63.2, score: -77.7 },
    { outletId: 'OUT1045', name: 'Toko Anugerah', outletType: 'Toko Kelontong', baseline: 798_000, current: 360_000, momPct: -54.9, score: -69.3 },
    { outletId: 'OUT1043', name: 'Minimarket Sido Muncul', outletType: 'Minimarket', baseline: 9_181_700, current: 2_873_700, momPct: -68.7, score: -68.6 },
    { outletId: 'OUT1041', name: 'Toko Anugerah', outletType: 'Toko Kelontong', baseline: 12_494_900, current: 5_909_600, momPct: -52.7, score: -67.2 },
    { outletId: 'OUT1048', name: 'Toko Mekar', outletType: 'Toko Kelontong', baseline: 5_143_700, current: 2_473_900, momPct: -51.9, score: -66.4 },
  ],
}
