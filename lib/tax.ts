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
  const basic_deduction = year === 2024 ? 480000 : 680000;

  const total_dividend_income = div_jpy_tokutei + div_usd_jpy_tokutei;
  const business_income = Math.max(0, sales - expenses - blue_deduction);
  const total_income = business_income + total_dividend_income;

  const total_deductions =
    national_pension +
    health_insurance +
    ideco +
    donation_deduction +
    medical_deduction +
    basic_deduction;

  const taxable_income = Math.max(0, total_income - total_deductions);
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

  let furusato_residence_deduction = 0;
  if (donation_deduction > 2000) {
    const target_furusato = donation_deduction - 2000;
    const furusato_basic = target_furusato * 0.1;
    const current_tax_rate = calc_taxable > 0 ? income_tax / calc_taxable : 0;
    const furusato_special = Math.min(
      target_furusato * (0.9 - current_tax_rate * 1.021),
      residence_income * 0.2
    );
    furusato_residence_deduction = furusato_basic + furusato_special;
  }

  const teigaku_genzei_residence = year === 2024 ? 10000 : 0;
  const residence_income_tax_final = Math.max(
    0,
    residence_income -
      adjustment_deduction -
      residence_dividend_deduction -
      furusato_residence_deduction -
      teigaku_genzei_residence
  );
  const residence_tax = Math.round((residence_income_tax_final + 5000) / 100) * 100;

  // 消費税
  const consumption_tax = Math.round(((sales / 1.1) * 0.02) / 100) * 100;

  // ふるさと納税限度額
  const current_tax_ratio = calc_taxable > 0 ? income_tax / calc_taxable : 0;
  const denominator = 0.9 - current_tax_ratio * 1.021;
  const furusato_limit =
    denominator > 0
      ? Math.floor((taxable_income * 0.1 * 0.2) / denominator + 2000)
      : 2000;

  // 国民健康保険料
  const kokuho_base_income = Math.max(0, total_income - 430000);
  let rate_medical = 0.0771;
  let capita_medical = 47300;
  let rate_support = 0.0269;
  let capita_support = 16800;

  if (year === 2024) {
    rate_medical = 0.0869;
    capita_medical = 49100;
    rate_support = 0.028;
    capita_support = 16500;
  }

  const medical_amount = kokuho_base_income * rate_medical + capita_medical;
  const support_amount = kokuho_base_income * rate_support + capita_support;
  const calculated_h_ins = Math.floor(medical_amount + support_amount);

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

