export interface TaxCalculationParams {
  year: number;
  sales: number;
  expenses: number;
  national_pension: number;
  health_insurance: number;
  ideco: number;
  donation_deduction: number;
  medical_deduction: number;
  div_jpy_tokutei: number;
  div_usd_jpy_tokutei: number;
}

export interface TaxCalculationResult {
  total_dividend_income: number;
  business_income: number;
  total_income: number;
  taxable_income: number;
  income_tax: number;
  final_tax_amount: number;
  residence_tax: number;
  consumption_tax: number;
  calculated_h_ins: number;
  furusato_limit: number;
}

/**
 * 所得税の基礎控除。合計所得金額(所得控除を引く前)に応じて変わる。
 * 令和7年分: 国税庁の確定申告書の記載(336万超489万以下で68万円)と一致を確認済み。
 * 令和8年分以降は税制改正後の値(489万円以下104万円・655万円以下67万円・2,350万円以下62万円)。
 */
function basicDeduction(year: number, totalIncome: number): number {
  const high = totalIncome <= 24000000 ? null : totalIncome <= 24500000 ? 320000 : totalIncome <= 25000000 ? 160000 : 0;
  if (high !== null) return high;
  if (year <= 2024) return 480000;
  if (year === 2025) {
    if (totalIncome <= 1320000) return 950000;
    if (totalIncome <= 3360000) return 880000;
    if (totalIncome <= 4890000) return 680000;
    if (totalIncome <= 6550000) return 630000;
    return 580000;
  }
  if (totalIncome <= 4890000) return 1040000;
  if (totalIncome <= 6550000) return 670000;
  return 620000;
}

/** 所得税の限界税率(課税所得にかかる最も高い税率)。ふるさと納税の計算で使う */
function marginalRate(taxable: number): number {
  if (taxable <= 1950000) return 0.05;
  if (taxable <= 3300000) return 0.1;
  if (taxable <= 6950000) return 0.2;
  if (taxable <= 8990000) return 0.23;
  if (taxable <= 17990000) return 0.33;
  if (taxable <= 39990000) return 0.4;
  return 0.45;
}

export function calculateTax(params: TaxCalculationParams): TaxCalculationResult {
  const {
    year,
    sales,
    expenses,
    national_pension,
    health_insurance,
    ideco,
    donation_deduction,
    medical_deduction,
    div_jpy_tokutei,
    div_usd_jpy_tokutei,
  } = params;

  const blue_deduction = 650000;
  const total_dividend_income = div_jpy_tokutei + div_usd_jpy_tokutei;
  const business_income = Math.max(0, sales - expenses - blue_deduction);
  const total_income = business_income + total_dividend_income;
  const basic_deduction = basicDeduction(year, total_income);

  // 寄附金控除は寄附額から2,000円を引いた額
  const donation_income_deduction = Math.max(0, donation_deduction - 2000);
  const other_deductions =
    national_pension + health_insurance + ideco + medical_deduction + basic_deduction;
  const total_deductions = other_deductions + donation_income_deduction;

  const taxable_income = Math.max(0, total_income - total_deductions);
  // ふるさと納税の限度額は、寄附金控除を引く前の所得で計算する
  const taxable_before_donation = Math.max(0, total_income - other_deductions);
  const calc_taxable = Math.floor(taxable_income / 1000) * 1000;

  // 所得税額（累進課税）
  let income_tax = 0;
  if (calc_taxable <= 1950000) {
    income_tax = Math.floor(calc_taxable * 0.05);
  } else if (calc_taxable <= 3300000) {
    income_tax = Math.floor(calc_taxable * 0.1 - 97500);
  } else if (calc_taxable <= 6950000) {
    income_tax = Math.floor(calc_taxable * 0.2 - 427500);
  } else if (calc_taxable <= 8990000) {
    income_tax = Math.floor(calc_taxable * 0.23 - 636000);
  } else if (calc_taxable <= 17990000) {
    income_tax = Math.floor(calc_taxable * 0.33 - 1536000);
  } else if (calc_taxable <= 39990000) {
    income_tax = Math.floor(calc_taxable * 0.4 - 2796000);
  } else {
    income_tax = Math.floor(calc_taxable * 0.45 - 4796000);
  }

  // 税額控除
  const dividend_deduction = Math.round((div_jpy_tokutei * 0.1) / 10) * 10;
  const standard_tax = Math.max(0, income_tax - dividend_deduction);
  const reconstruction_tax = Math.floor(standard_tax * 0.021);
  const total_income_tax_pre_cut = standard_tax + reconstruction_tax;

  // 定額減税（2024年のみ）
  const teigaku_genzei_tax = year === 2024 ? 30000 : 0;
  const total_income_tax_with_reconstruction = Math.max(
    0,
    total_income_tax_pre_cut - teigaku_genzei_tax
  );

  // 外国税額控除
  const foreign_withholding_tax = Math.round((div_usd_jpy_tokutei * 0.1) / 10) * 10;
  const limit_foreign_tax_credit =
    total_income > 0
      ? Math.floor(
          total_income_tax_with_reconstruction *
            (div_usd_jpy_tokutei / total_income)
        )
      : 0;
  const foreign_tax_credit = Math.min(
    foreign_withholding_tax,
    limit_foreign_tax_credit
  );

  // 源泉徴収税額
  const withholding_tax = Math.floor(
    (div_jpy_tokutei + div_usd_jpy_tokutei * 0.9) * 0.15315
  );

  // 最終的な精算額（マイナスは還付）
  const final_tax_amount =
    Math.round(
      (total_income_tax_with_reconstruction -
        foreign_tax_credit -
        withholding_tax) /
        100
    ) * 100;

  // 住民税の計算
  const residence_total_deductions =
    national_pension + health_insurance + ideco + medical_deduction + 430000;
  const residence_taxable_income = Math.max(
    0,
    Math.round((total_income - residence_total_deductions) / 100) * 100
  );
  const residence_income = residence_taxable_income * 0.1;

  let adjustment_deduction = 0;
  if (residence_taxable_income <= 2000000) {
    adjustment_deduction =
      Math.min(50000, residence_taxable_income) * 0.05;
  } else {
    adjustment_deduction = Math.max(
      2500,
      (50000 - (residence_taxable_income - 2000000)) * 0.05
    );
  }

  const residence_dividend_deduction = Math.floor(div_jpy_tokutei * 0.028);
  // 配当割額控除: 特定口座で天引きされた住民税(配当割5%)を、住民税の所得割から差し引く。米国株は現地課税10%を引いた後の額が対象
  const dividend_wari_credit = Math.floor((div_jpy_tokutei + div_usd_jpy_tokutei * 0.9) * 0.05);
  // 調整控除・配当控除を引いた後の所得割額。ふるさと納税の特例分の上限と限度額の基準になる
  const residence_base_tax = Math.max(
    0,
    residence_income - adjustment_deduction - residence_dividend_deduction
  );

  let furusato_residence_deduction = 0;
  if (donation_deduction > 2000) {
    const target_furusato = donation_deduction - 2000;
    const furusato_basic = target_furusato * 0.1;
    const furusato_special = Math.min(
      target_furusato * (0.9 - marginalRate(calc_taxable) * 1.021),
      residence_base_tax * 0.2
    );
    furusato_residence_deduction = furusato_basic + Math.max(0, furusato_special);
  }

  const residence_income_tax_final = Math.max(
    0,
    residence_income -
      adjustment_deduction -
      residence_dividend_deduction -
      furusato_residence_deduction -
      dividend_wari_credit
  );
  const residence_tax = Math.round((residence_income_tax_final + 5000) / 100) * 100;

  // 消費税。令和8年分までは2割特例(売上税額の20%=税抜売上の2%)。令和7年分の申告書(納付151,900円)と一致を確認済み。
  // 令和9年分からは2割特例がないため、簡易課税の第5種(みなし仕入率50%: 税抜売上の10%×50%=5%)で見積もる(要・届出)
  const consumption_rate = year <= 2026 ? 0.02 : 0.05;
  const consumption_tax = Math.round(((sales / 1.1) * consumption_rate) / 100) * 100;

  // ふるさと納税限度額: 住民税所得割額の20%まで特例控除が受けられる前提で、寄附金控除を引く前の限界税率から逆算する
  const denominator = 0.9 - marginalRate(Math.floor(taxable_before_donation / 1000) * 1000) * 1.021;
  const furusato_limit =
    denominator > 0 ? Math.floor((residence_base_tax * 0.2) / denominator + 2000) : 2000;

  // 国民健康保険料(杉並区・介護分なし)。賦課標準額=総所得金額等−43万円。2025年分以降は令和8年度の料率
  const kokuho_base_income = Math.max(0, total_income - 430000);
  let medical = { rate: 0.0751, capita: 47600, cap: 670000 };
  let support = { rate: 0.028, capita: 17600, cap: 260000 };
  // 令和8年度から新設の子ども・子育て支援金分
  let child: { rate: number; capita: number; cap: number } | null = {
    rate: 0.0027,
    capita: 1873,
    cap: 30000,
  };

  // 2024年の所得で決まる令和7年度の料率(2024年分の実績: 国保398,517円と照合)
  if (year === 2024) {
    medical = { rate: 0.0771, capita: 47300, cap: Infinity };
    support = { rate: 0.0269, capita: 16800, cap: Infinity };
    child = null;
  }

  const kokuhoPart = (p: { rate: number; capita: number; cap: number }) =>
    Math.min(kokuho_base_income * p.rate + p.capita, p.cap);
  const calculated_h_ins = Math.floor(
    kokuhoPart(medical) + kokuhoPart(support) + (child ? kokuhoPart(child) : 0)
  );

  return {
    total_dividend_income,
    business_income,
    total_income,
    taxable_income,
    income_tax,
    final_tax_amount,
    residence_tax,
    consumption_tax,
    calculated_h_ins,
    furusato_limit,
  };
}

