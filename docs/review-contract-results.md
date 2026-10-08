# 证据与规则安全边界实验

来源：Developer-authored fixed engineering expectations registered before execution; not expert labels, independent blind review or a quality estimate。

工程边界通过 30/30，失败 0；正式批注原文位置有效 11/11。
执行器 4.1.0；引文策略 exact-occurrence@2；门槛 all_engineering_contracts_passed。
受控回调 55 次；真实外部模型调用 0 次。
固定材料 SHA-256：c2e54d90c8145361eafb29d73695e56da6aef2f707586aec945f08f7d4e6864f。

本实验实际执行生产服务、存储、引文校验、逐条复核和报告流程。候选与复核响应由开发者预先冻结，没有进行模型语义评价；不是专家准确率或独立盲评。每用例只启用指定检查子集，分数只用于验证边界，不作为完整期刊评审。

| 用例 | 边界 | 指定检查 | 正式批注/计分分母 | 完成状态 | 结果 |
| --- | --- | --- | --- | --- | --- |
| unique-issue | evidence | E04 | 1/15 | provisional | 通过 |
| supported-source | evidence | E04 | 0/15 | provisional | 通过 |
| repeated-no-offset | occurrence | E04 | 0/0 | needs\_information | 通过 |
| repeated-second-offset | occurrence | E04 | 1/15 | provisional | 通过 |
| repeated-wrong-offset | occurrence | E04 | 0/0 | needs\_information | 通过 |
| string-offset | occurrence | E04 | 0/0 | needs\_information | 通过 |
| unknown-element | evidence | E04 | 0/0 | needs\_information | 通过 |
| invented-quotation | evidence | E04 | 0/0 | needs\_information | 通过 |
| unique-typography | occurrence | E04 | 1/15 | provisional | 通过 |
| typography-explicit-mismatch | occurrence | E04 | 0/0 | needs\_information | 通过 |
| no-citation | information | E04 | 0/0 | needs\_information | 通过 |
| missing-material-claim | information | E04 | 0/0 | needs\_information | 通过 |
| external-comparison-unavailable | applicability | E02 | 0/0 | needs\_information | 通过 |
| visual-material-unavailable | applicability | E09 | 0/0 | needs\_information | 通过 |
| verifier-rejects-reasoning | verification | E04 | 0/0 | needs\_information | 通过 |
| verifier-rejects-applicability | applicability | E04 | 0/0 | needs\_information | 通过 |
| invalid-supported-grade | scoring | E04 | 0/0 | needs\_information | 通过 |
| invalid-issue-grade | scoring | E04 | 0/0 | needs\_information | 通过 |
| invalid-verifier-shape | verification | E04 | 0/0 | needs\_information | 通过 |
| atomic-valid | atomicity | E07 | 1/10 | provisional | 通过 |
| atomic-material-request | information | E07 | 0/0 | needs\_information | 通过 |
| atomic-verifier-downgrade | information | E07 | 0/0 | needs\_information | 通过 |
| atomic-wrong-owner | ownership | E07 | 0/0 | needs\_information | 通过 |
| atomic-not-one-problem | atomicity | E07 | 0/0 | needs\_information | 通过 |
| atomic-verifier-not-covered | verification | E07 | 0/0 | needs\_information | 通过 |
| atomic-real-duplicate | deduplication | E07 | 1/10 | provisional | 通过 |
| atomic-independent-categories | deduplication | E07 | 2/10 | provisional | 通过 |
| atomic-self-duplicate | deduplication | E07 | 1/10 | provisional | 通过 |
| atomic-duplicate-without-shared-evidence | deduplication | E07 | 2/10 | provisional | 通过 |
| atomic-mixed-valid-invalid-citation | partial-coverage | E07 | 1/0 | needs\_information | 通过 |

全部失败与受控输入保留；完整模块、位置、规则指纹和拒绝理由见同名 JSON。该门槛不发布正式规则，专家试标、真实模型对照和保留测试集仍待开展。
