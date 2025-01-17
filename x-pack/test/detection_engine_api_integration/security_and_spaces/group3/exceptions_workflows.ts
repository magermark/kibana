/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/* eslint-disable @typescript-eslint/naming-convention */

import expect from 'expect';
import type {
  CreateExceptionListItemSchema,
  UpdateExceptionListItemSchema,
} from '@kbn/securitysolution-io-ts-list-types';
import {
  EXCEPTION_LIST_ITEM_URL,
  EXCEPTION_LIST_URL,
  LIST_URL,
} from '@kbn/securitysolution-list-constants';
import type {
  RuleCreateProps,
  EqlRuleCreateProps,
  QueryRuleCreateProps,
  ThreatMatchRuleCreateProps,
  ThresholdRuleCreateProps,
} from '@kbn/security-solution-plugin/common/api/detection_engine';
import { getCreateExceptionListItemMinimalSchemaMock } from '@kbn/lists-plugin/common/schemas/request/create_exception_list_item_schema.mock';
import {
  getCreateExceptionListDetectionSchemaMock,
  getCreateExceptionListMinimalSchemaMock,
} from '@kbn/lists-plugin/common/schemas/request/create_exception_list_schema.mock';

import { DETECTION_ENGINE_RULES_URL } from '@kbn/security-solution-plugin/common/constants';
import { ROLES } from '@kbn/security-solution-plugin/common/test';
import { ELASTIC_SECURITY_RULE_ID } from '@kbn/security-solution-plugin/common';
import { getUpdateMinimalExceptionListItemSchemaMock } from '@kbn/lists-plugin/common/schemas/request/update_exception_list_item_schema.mock';
import { FtrProviderContext } from '../../common/ftr_provider_context';
import {
  createSignalsIndex,
  deleteAllRules,
  deleteAllAlerts,
  getSimpleRule,
  getSimpleRuleOutput,
  removeServerGeneratedProperties,
  downgradeImmutableRule,
  createRule,
  waitForRuleSuccess,
  installMockPrebuiltRules,
  getRule,
  createExceptionList,
  createExceptionListItem,
  waitForSignalsToBePresent,
  getSignalsByIds,
  findImmutableRuleById,
  getPrebuiltRulesAndTimelinesStatus,
  getOpenSignals,
  createRuleWithExceptionEntries,
  getEqlRuleForSignalTesting,
  getThresholdRuleForSignalTesting,
} from '../../utils';
import {
  createListsIndex,
  deleteAllExceptions,
  deleteListsIndex,
  importFile,
} from '../../../lists_api_integration/utils';
import { createUserAndRole, deleteUserAndRole } from '../../../common/services/security_solution';
import { SAMPLE_PREBUILT_RULES } from '../../utils/prebuilt_rules/create_prebuilt_rule_saved_objects';

// eslint-disable-next-line import/no-default-export
export default ({ getService }: FtrProviderContext) => {
  const supertest = getService('supertest');
  const supertestWithoutAuth = getService('supertestWithoutAuth');
  const esArchiver = getService('esArchiver');
  const log = getService('log');
  const es = getService('es');

  describe('create_rules_with_exceptions', () => {
    before(async () => {
      await esArchiver.load('x-pack/test/functional/es_archives/auditbeat/hosts');
    });

    after(async () => {
      await esArchiver.unload('x-pack/test/functional/es_archives/auditbeat/hosts');
    });

    describe('creating rules with exceptions', () => {
      beforeEach(async () => {
        await createSignalsIndex(supertest, log);
      });

      afterEach(async () => {
        await deleteAllAlerts(supertest, log, es);
        await deleteAllRules(supertest, log);
        await deleteAllExceptions(supertest, log);
      });

      describe('elastic admin', () => {
        it('should create a single rule with a rule_id and add an exception list to the rule', async () => {
          const {
            body: { id, list_id, namespace_type, type },
          } = await supertest
            .post(EXCEPTION_LIST_URL)
            .set('kbn-xsrf', 'true')
            .send(getCreateExceptionListMinimalSchemaMock())
            .expect(200);

          const ruleWithException: RuleCreateProps = {
            ...getSimpleRule(),
            exceptions_list: [
              {
                id,
                list_id,
                namespace_type,
                type,
              },
            ],
          };

          const rule = await createRule(supertest, log, ruleWithException);
          const expected = {
            ...getSimpleRuleOutput(),
            exceptions_list: [
              {
                id,
                list_id,
                namespace_type,
                type,
              },
            ],
          };
          const bodyToCompare = removeServerGeneratedProperties(rule);
          expect(bodyToCompare).toEqual(expected);
        });

        it('should create a single rule with an exception list and validate it ran successfully', async () => {
          const {
            body: { id, list_id, namespace_type, type },
          } = await supertest
            .post(EXCEPTION_LIST_URL)
            .set('kbn-xsrf', 'true')
            .send(getCreateExceptionListMinimalSchemaMock())
            .expect(200);

          const ruleWithException: RuleCreateProps = {
            ...getSimpleRule(),
            enabled: true,
            exceptions_list: [
              {
                id,
                list_id,
                namespace_type,
                type,
              },
            ],
          };

          const rule = await createRule(supertest, log, ruleWithException);
          await waitForRuleSuccess({ supertest, log, id: rule.id });
          const bodyToCompare = removeServerGeneratedProperties(rule);

          const expected = {
            ...getSimpleRuleOutput(),
            enabled: true,
            exceptions_list: [
              {
                id,
                list_id,
                namespace_type,
                type,
              },
            ],
          };
          expect(bodyToCompare).toEqual(expected);
        });

        it('should allow removing an exception list from an immutable rule through patch', async () => {
          await installMockPrebuiltRules(supertest, es);

          // This rule has an existing exceptions_list that we are going to use
          const immutableRule = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);
          expect(immutableRule.exceptions_list.length).toBeGreaterThan(0); // make sure we have at least one exceptions_list

          // remove the exceptions list as a user is allowed to remove it from an immutable rule
          await supertest
            .patch(DETECTION_ENGINE_RULES_URL)
            .set('kbn-xsrf', 'true')
            .set('elastic-api-version', '2023-10-31')
            .send({ rule_id: ELASTIC_SECURITY_RULE_ID, exceptions_list: [] })
            .expect(200);

          const immutableRuleSecondTime = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);
          expect(immutableRuleSecondTime.exceptions_list.length).toEqual(0);
        });

        it('should allow adding a second exception list to an immutable rule through patch', async () => {
          await installMockPrebuiltRules(supertest, es);

          const { id, list_id, namespace_type, type } = await createExceptionList(
            supertest,
            log,
            getCreateExceptionListMinimalSchemaMock()
          );

          // This rule has an existing exceptions_list that we are going to use
          const immutableRule = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);
          expect(immutableRule.exceptions_list.length).toBeGreaterThan(0); // make sure we have at least one

          // add a second exceptions list as a user is allowed to add a second list to an immutable rule
          await supertest
            .patch(DETECTION_ENGINE_RULES_URL)
            .set('kbn-xsrf', 'true')
            .set('elastic-api-version', '2023-10-31')
            .send({
              rule_id: ELASTIC_SECURITY_RULE_ID,
              exceptions_list: [
                ...immutableRule.exceptions_list,
                {
                  id,
                  list_id,
                  namespace_type,
                  type,
                },
              ],
            })
            .expect(200);

          const immutableRuleSecondTime = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);

          expect(immutableRuleSecondTime.exceptions_list.length).toEqual(2);
        });

        it('should override any updates to pre-packaged rules if the user removes the exception list through the API but the new version of a rule has an exception list again', async () => {
          await installMockPrebuiltRules(supertest, es);

          // This rule has an existing exceptions_list that we are going to use
          const immutableRule = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);
          expect(immutableRule.exceptions_list.length).toBeGreaterThan(0); // make sure we have at least one

          await supertest
            .patch(DETECTION_ENGINE_RULES_URL)
            .set('kbn-xsrf', 'true')
            .set('elastic-api-version', '2023-10-31')
            .send({ rule_id: ELASTIC_SECURITY_RULE_ID, exceptions_list: [] })
            .expect(200);

          await downgradeImmutableRule(es, log, ELASTIC_SECURITY_RULE_ID);
          await installMockPrebuiltRules(supertest, es);
          const immutableRuleSecondTime = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);

          // We should have a length of 1 and it should be the same as our original before we tried to remove it using patch
          expect(immutableRuleSecondTime.exceptions_list.length).toEqual(1);
          expect(immutableRuleSecondTime.exceptions_list).toEqual(immutableRule.exceptions_list);
        });

        it('should merge back an exceptions_list if it was removed from the immutable rule through PATCH', async () => {
          await installMockPrebuiltRules(supertest, es);

          const { id, list_id, namespace_type, type } = await createExceptionList(
            supertest,
            log,
            getCreateExceptionListMinimalSchemaMock()
          );

          // This rule has an existing exceptions_list that we are going to ensure does not stomp on our existing rule
          const immutableRule = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);
          expect(immutableRule.exceptions_list.length).toBeGreaterThan(0); // make sure we have at least one

          // remove the exception list and only have a single list that is not an endpoint_list
          await supertest
            .patch(DETECTION_ENGINE_RULES_URL)
            .set('kbn-xsrf', 'true')
            .set('elastic-api-version', '2023-10-31')
            .send({
              rule_id: ELASTIC_SECURITY_RULE_ID,
              exceptions_list: [
                {
                  id,
                  list_id,
                  namespace_type,
                  type,
                },
              ],
            })
            .expect(200);

          await downgradeImmutableRule(es, log, ELASTIC_SECURITY_RULE_ID);
          await installMockPrebuiltRules(supertest, es);
          const immutableRuleSecondTime = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);

          expect(immutableRuleSecondTime.exceptions_list).toEqual([
            ...immutableRule.exceptions_list,
            {
              id,
              list_id,
              namespace_type,
              type,
            },
          ]);
        });

        it('should NOT add an extra exceptions_list that already exists on a rule during an upgrade', async () => {
          await installMockPrebuiltRules(supertest, es);

          // This rule has an existing exceptions_list that we are going to ensure does not stomp on our existing rule
          const immutableRule = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);
          expect(immutableRule.exceptions_list.length).toBeGreaterThan(0); // make sure we have at least one

          await downgradeImmutableRule(es, log, ELASTIC_SECURITY_RULE_ID);
          await installMockPrebuiltRules(supertest, es);

          const immutableRuleSecondTime = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);

          // The installed rule should have both the original immutable exceptions list back and the
          // new list the user added.
          expect(immutableRuleSecondTime.exceptions_list).toEqual([
            ...immutableRule.exceptions_list,
          ]);
        });

        it('should NOT allow updates to pre-packaged rules to overwrite existing exception based rules when the user adds an additional exception list', async () => {
          await installMockPrebuiltRules(supertest, es);

          const { id, list_id, namespace_type, type } = await createExceptionList(
            supertest,
            log,
            getCreateExceptionListMinimalSchemaMock()
          );

          // This rule has an existing exceptions_list that we are going to ensure does not stomp on our existing rule
          const immutableRule = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);

          // add a second exceptions list as a user is allowed to add a second list to an immutable rule
          await supertest
            .patch(DETECTION_ENGINE_RULES_URL)
            .set('kbn-xsrf', 'true')
            .set('elastic-api-version', '2023-10-31')
            .send({
              rule_id: ELASTIC_SECURITY_RULE_ID,
              exceptions_list: [
                ...immutableRule.exceptions_list,
                {
                  id,
                  list_id,
                  namespace_type,
                  type,
                },
              ],
            })
            .expect(200);

          await downgradeImmutableRule(es, log, ELASTIC_SECURITY_RULE_ID);
          await installMockPrebuiltRules(supertest, es);
          const immutableRuleSecondTime = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);

          // It should be the same as what the user added originally
          expect(immutableRuleSecondTime.exceptions_list).toEqual([
            ...immutableRule.exceptions_list,
            {
              id,
              list_id,
              namespace_type,
              type,
            },
          ]);
        });

        it('should not remove any exceptions added to a pre-packaged/immutable rule during an update if that rule has no existing exception lists', async () => {
          await installMockPrebuiltRules(supertest, es);

          // Create a new exception list
          const { id, list_id, namespace_type, type } = await createExceptionList(
            supertest,
            log,
            getCreateExceptionListMinimalSchemaMock()
          );

          // Find a rule without exceptions_list
          const ruleWithoutExceptionList = SAMPLE_PREBUILT_RULES.find(
            (rule) => !rule['security-rule'].exceptions_list
          );
          const ruleId = ruleWithoutExceptionList?.['security-rule'].rule_id;
          if (!ruleId) {
            throw new Error('Cannot find a rule without exceptions_list in the sample data');
          }

          const immutableRule = await getRule(supertest, log, ruleId);
          expect(immutableRule.exceptions_list.length).toEqual(0); // make sure we have no exceptions_list

          // add a second exceptions list as a user is allowed to add a second list to an immutable rule
          await supertest
            .patch(DETECTION_ENGINE_RULES_URL)
            .set('kbn-xsrf', 'true')
            .set('elastic-api-version', '2023-10-31')
            .send({
              rule_id: ruleId,
              exceptions_list: [
                {
                  id,
                  list_id,
                  namespace_type,
                  type,
                },
              ],
            })
            .expect(200);

          await downgradeImmutableRule(es, log, ruleId);
          await installMockPrebuiltRules(supertest, es);
          const immutableRuleSecondTime = await getRule(supertest, log, ruleId);

          expect(immutableRuleSecondTime.exceptions_list).toEqual([
            {
              id,
              list_id,
              namespace_type,
              type,
            },
          ]);
        });

        it('should not change the immutable tags when adding a second exception list to an immutable rule through patch', async () => {
          await installMockPrebuiltRules(supertest, es);

          const { id, list_id, namespace_type, type } = await createExceptionList(
            supertest,
            log,
            getCreateExceptionListMinimalSchemaMock()
          );

          // This rule has an existing exceptions_list that we are going to use
          const immutableRule = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);
          expect(immutableRule.exceptions_list.length).toBeGreaterThan(0); // make sure we have at least one

          // add a second exceptions list as a user is allowed to add a second list to an immutable rule
          await supertest
            .patch(DETECTION_ENGINE_RULES_URL)
            .set('kbn-xsrf', 'true')
            .set('elastic-api-version', '2023-10-31')
            .send({
              rule_id: ELASTIC_SECURITY_RULE_ID,
              exceptions_list: [
                ...immutableRule.exceptions_list,
                {
                  id,
                  list_id,
                  namespace_type,
                  type,
                },
              ],
            })
            .expect(200);

          const body = await findImmutableRuleById(supertest, log, ELASTIC_SECURITY_RULE_ID);
          expect(body.data.length).toEqual(1); // should have only one length to the data set, otherwise we have duplicates or the tags were removed and that is incredibly bad.

          const bodyToCompare = removeServerGeneratedProperties(body.data[0]);
          expect(bodyToCompare.rule_id).toEqual(immutableRule.rule_id); // Rule id should not change with a a patch
          expect(bodyToCompare.immutable).toEqual(immutableRule.immutable); // Immutable should always stay the same which is true and never flip to false.
          expect(bodyToCompare.version).toEqual(immutableRule.version); // The version should never update on a patch
        });

        it('should not change count of prepacked rules when adding a second exception list to an immutable rule through patch. If this fails, suspect the immutable tags are not staying on the rule correctly.', async () => {
          await installMockPrebuiltRules(supertest, es);

          const { id, list_id, namespace_type, type } = await createExceptionList(
            supertest,
            log,
            getCreateExceptionListMinimalSchemaMock()
          );

          // This rule has an existing exceptions_list that we are going to use
          const immutableRule = await getRule(supertest, log, ELASTIC_SECURITY_RULE_ID);
          expect(immutableRule.exceptions_list.length).toBeGreaterThan(0); // make sure we have at least one

          // add a second exceptions list as a user is allowed to add a second list to an immutable rule
          await supertest
            .patch(DETECTION_ENGINE_RULES_URL)
            .set('kbn-xsrf', 'true')
            .set('elastic-api-version', '2023-10-31')
            .send({
              rule_id: ELASTIC_SECURITY_RULE_ID,
              exceptions_list: [
                ...immutableRule.exceptions_list,
                {
                  id,
                  list_id,
                  namespace_type,
                  type,
                },
              ],
            })
            .expect(200);

          const status = await getPrebuiltRulesAndTimelinesStatus(supertest);
          expect(status.rules_not_installed).toEqual(0);
        });
      });

      describe('t1_analyst', () => {
        const role = ROLES.t1_analyst;

        beforeEach(async () => {
          await createUserAndRole(getService, role);
        });

        afterEach(async () => {
          await deleteUserAndRole(getService, role);
        });

        it('should NOT be able to create an exception list', async () => {
          await supertestWithoutAuth
            .post(EXCEPTION_LIST_ITEM_URL)
            .auth(role, 'changeme')
            .set('kbn-xsrf', 'true')
            .send(getCreateExceptionListItemMinimalSchemaMock())
            .expect(403);
        });

        it('should NOT be able to create an exception list item', async () => {
          await supertestWithoutAuth
            .post(EXCEPTION_LIST_ITEM_URL)
            .auth(role, 'changeme')
            .set('kbn-xsrf', 'true')
            .send(getCreateExceptionListItemMinimalSchemaMock())
            .expect(403);
        });
      });

      describe('tests with auditbeat data', () => {
        before(async () => {
          await esArchiver.load('x-pack/test/functional/es_archives/auditbeat/hosts');
        });

        after(async () => {
          await esArchiver.unload('x-pack/test/functional/es_archives/auditbeat/hosts');
        });

        beforeEach(async () => {
          await createSignalsIndex(supertest, log);
        });

        afterEach(async () => {
          await deleteAllAlerts(supertest, log, es);
          await deleteAllRules(supertest, log);
          await deleteAllExceptions(supertest, log);
        });

        it('should be able to execute against an exception list that does not include valid entries and get back 10 signals', async () => {
          const { id, list_id, namespace_type, type } = await createExceptionList(
            supertest,
            log,
            getCreateExceptionListMinimalSchemaMock()
          );

          const exceptionListItem: CreateExceptionListItemSchema = {
            ...getCreateExceptionListItemMinimalSchemaMock(),
            entries: [
              {
                field: 'some.none.existent.field', // non-existent field where we should not exclude anything
                operator: 'included',
                type: 'match',
                value: 'some value',
              },
            ],
          };
          await createExceptionListItem(supertest, log, exceptionListItem);

          const ruleWithException: RuleCreateProps = {
            name: 'Simple Rule Query',
            description: 'Simple Rule Query',
            enabled: true,
            risk_score: 1,
            rule_id: 'rule-1',
            severity: 'high',
            index: ['auditbeat-*'],
            type: 'query',
            from: '1900-01-01T00:00:00.000Z',
            query: 'host.name: "suricata-sensor-amsterdam"',
            exceptions_list: [
              {
                id,
                list_id,
                namespace_type,
                type,
              },
            ],
          };
          const { id: createdId } = await createRule(supertest, log, ruleWithException);
          await waitForRuleSuccess({ supertest, log, id: createdId });
          await waitForSignalsToBePresent(supertest, log, 10, [createdId]);
          const signalsOpen = await getSignalsByIds(supertest, log, [createdId]);
          expect(signalsOpen.hits.hits.length).toEqual(10);
        });

        it('should be able to execute against an exception list that does include valid entries and get back 0 signals', async () => {
          const rule: QueryRuleCreateProps = {
            name: 'Simple Rule Query',
            description: 'Simple Rule Query',
            enabled: true,
            risk_score: 1,
            rule_id: 'rule-1',
            severity: 'high',
            index: ['auditbeat-*'],
            type: 'query',
            from: '1900-01-01T00:00:00.000Z',
            query: 'host.name: "suricata-sensor-amsterdam"',
          };
          const createdRule = await createRuleWithExceptionEntries(supertest, log, rule, [
            [
              {
                field: 'host.name', // This matches the query above which will exclude everything
                operator: 'included',
                type: 'match',
                value: 'suricata-sensor-amsterdam',
              },
            ],
          ]);
          const signalsOpen = await getOpenSignals(supertest, log, es, createdRule);
          expect(signalsOpen.hits.hits.length).toEqual(0);
        });

        it('should be able to execute against an exception list that does include valid case sensitive entries and get back 0 signals', async () => {
          const rule: QueryRuleCreateProps = {
            name: 'Simple Rule Query',
            description: 'Simple Rule Query',
            enabled: true,
            risk_score: 1,
            rule_id: 'rule-1',
            severity: 'high',
            index: ['auditbeat-*'],
            type: 'query',
            from: '1900-01-01T00:00:00.000Z',
            query: 'host.name: "suricata-sensor-amsterdam"',
          };
          const rule2: QueryRuleCreateProps = {
            name: 'Simple Rule Query',
            description: 'Simple Rule Query',
            enabled: true,
            risk_score: 1,
            rule_id: 'rule-2',
            severity: 'high',
            index: ['auditbeat-*'],
            type: 'query',
            from: '1900-01-01T00:00:00.000Z',
            query: 'host.name: "suricata-sensor-amsterdam"',
          };
          const createdRule = await createRuleWithExceptionEntries(supertest, log, rule, [
            [
              {
                field: 'host.os.name',
                operator: 'included',
                type: 'match_any',
                value: ['ubuntu'],
              },
            ],
          ]);
          const createdRule2 = await createRuleWithExceptionEntries(supertest, log, rule2, [
            [
              {
                field: 'host.os.name', // This matches the query above which will exclude everything
                operator: 'included',
                type: 'match_any',
                value: ['ubuntu', 'Ubuntu'],
              },
            ],
          ]);
          const signalsOpen = await getOpenSignals(supertest, log, es, createdRule);
          const signalsOpen2 = await getOpenSignals(supertest, log, es, createdRule2);
          // Expect signals here because all values are "Ubuntu"
          // and exception is one of ["ubuntu"]
          expect(signalsOpen.hits.hits.length).toEqual(10);
          // Expect no signals here because all values are "Ubuntu"
          // and exception is one of ["ubuntu", "Ubuntu"]
          expect(signalsOpen2.hits.hits.length).toEqual(0);
        });

        it('generates no signals when an exception is added for an EQL rule', async () => {
          const rule: EqlRuleCreateProps = {
            ...getEqlRuleForSignalTesting(['auditbeat-*']),
            query: 'configuration where agent.id=="a1d7b39c-f898-4dbe-a761-efb61939302d"',
          };
          const createdRule = await createRuleWithExceptionEntries(supertest, log, rule, [
            [
              {
                field: 'host.id',
                operator: 'included',
                type: 'match',
                value: '8cc95778cce5407c809480e8e32ad76b',
              },
            ],
          ]);
          const signalsOpen = await getOpenSignals(supertest, log, es, createdRule);
          expect(signalsOpen.hits.hits.length).toEqual(0);
        });

        it('generates no signals when an exception is added for a threshold rule', async () => {
          const rule: ThresholdRuleCreateProps = {
            ...getThresholdRuleForSignalTesting(['auditbeat-*']),
            threshold: {
              field: 'host.id',
              value: 700,
            },
          };
          const createdRule = await createRuleWithExceptionEntries(supertest, log, rule, [
            [
              {
                field: 'host.id',
                operator: 'included',
                type: 'match',
                value: '8cc95778cce5407c809480e8e32ad76b',
              },
            ],
          ]);
          const signalsOpen = await getOpenSignals(supertest, log, es, createdRule);
          expect(signalsOpen.hits.hits.length).toEqual(0);
        });

        it('generates no signals when an exception is added for a threat match rule', async () => {
          const rule: ThreatMatchRuleCreateProps = {
            description: 'Detecting root and admin users',
            name: 'Query with a rule id',
            severity: 'high',
            index: ['auditbeat-*'],
            type: 'threat_match',
            risk_score: 55,
            language: 'kuery',
            rule_id: 'rule-1',
            from: '1900-01-01T00:00:00.000Z',
            query: '*:*',
            threat_query: 'source.ip: "188.166.120.93"', // narrow things down with a query to a specific source ip
            threat_index: ['auditbeat-*'], // We use auditbeat as both the matching index and the threat list for simplicity
            threat_mapping: [
              // We match host.name against host.name
              {
                entries: [
                  {
                    field: 'host.name',
                    value: 'host.name',
                    type: 'mapping',
                  },
                ],
              },
            ],
            threat_filters: [],
          };

          const createdRule = await createRuleWithExceptionEntries(supertest, log, rule, [
            [
              {
                field: 'source.ip',
                operator: 'included',
                type: 'match',
                value: '188.166.120.93',
              },
            ],
          ]);
          const signalsOpen = await getOpenSignals(supertest, log, es, createdRule);
          expect(signalsOpen.hits.hits.length).toEqual(0);
        });
        describe('rules with value list exceptions', () => {
          beforeEach(async () => {
            await createListsIndex(supertest, log);
          });

          afterEach(async () => {
            await deleteListsIndex(supertest, log);
          });

          it('generates no signals when a value list exception is added for a query rule', async () => {
            const valueListId = 'value-list-id';
            await importFile(supertest, log, 'keyword', ['suricata-sensor-amsterdam'], valueListId);
            const rule: QueryRuleCreateProps = {
              name: 'Simple Rule Query',
              description: 'Simple Rule Query',
              enabled: true,
              risk_score: 1,
              rule_id: 'rule-1',
              severity: 'high',
              index: ['auditbeat-*'],
              type: 'query',
              from: '1900-01-01T00:00:00.000Z',
              query: 'host.name: "suricata-sensor-amsterdam"',
            };
            const createdRule = await createRuleWithExceptionEntries(supertest, log, rule, [
              [
                {
                  field: 'host.name',
                  operator: 'included',
                  type: 'list',
                  list: {
                    id: valueListId,
                    type: 'keyword',
                  },
                },
              ],
            ]);
            const signalsOpen = await getOpenSignals(supertest, log, es, createdRule);
            expect(signalsOpen.hits.hits.length).toEqual(0);
          });

          it('generates no signals when a value list exception is added for a threat match rule', async () => {
            const valueListId = 'value-list-id';
            await importFile(supertest, log, 'keyword', ['zeek-sensor-amsterdam'], valueListId);
            const rule: ThreatMatchRuleCreateProps = {
              description: 'Detecting root and admin users',
              name: 'Query with a rule id',
              severity: 'high',
              index: ['auditbeat-*'],
              type: 'threat_match',
              risk_score: 55,
              language: 'kuery',
              rule_id: 'rule-1',
              from: '1900-01-01T00:00:00.000Z',
              query: '*:*',
              threat_query: 'source.ip: "188.166.120.93"', // narrow things down with a query to a specific source ip
              threat_index: ['auditbeat-*'], // We use auditbeat as both the matching index and the threat list for simplicity
              threat_mapping: [
                // We match host.name against host.name
                {
                  entries: [
                    {
                      field: 'host.name',
                      value: 'host.name',
                      type: 'mapping',
                    },
                  ],
                },
              ],
              threat_filters: [],
            };

            const createdRule = await createRuleWithExceptionEntries(supertest, log, rule, [
              [
                {
                  field: 'host.name',
                  operator: 'included',
                  type: 'list',
                  list: {
                    id: valueListId,
                    type: 'keyword',
                  },
                },
              ],
            ]);
            const signalsOpen = await getOpenSignals(supertest, log, es, createdRule);
            expect(signalsOpen.hits.hits.length).toEqual(0);
          });

          it('generates no signals when a value list exception is added for a threshold rule', async () => {
            const valueListId = 'value-list-id';
            await importFile(supertest, log, 'keyword', ['zeek-sensor-amsterdam'], valueListId);
            const rule: ThresholdRuleCreateProps = {
              description: 'Detecting root and admin users',
              name: 'Query with a rule id',
              severity: 'high',
              index: ['auditbeat-*'],
              type: 'threshold',
              risk_score: 55,
              language: 'kuery',
              rule_id: 'rule-1',
              from: '1900-01-01T00:00:00.000Z',
              query: 'host.name: "zeek-sensor-amsterdam"',
              threshold: {
                field: 'host.name',
                value: 1,
              },
            };

            const createdRule = await createRuleWithExceptionEntries(supertest, log, rule, [
              [
                {
                  field: 'host.name',
                  operator: 'included',
                  type: 'list',
                  list: {
                    id: valueListId,
                    type: 'keyword',
                  },
                },
              ],
            ]);
            const signalsOpen = await getOpenSignals(supertest, log, es, createdRule);
            expect(signalsOpen.hits.hits.length).toEqual(0);
          });

          it('generates no signals when a value list exception is added for an EQL rule', async () => {
            const valueListId = 'value-list-id';
            await importFile(supertest, log, 'keyword', ['zeek-sensor-amsterdam'], valueListId);
            const rule: EqlRuleCreateProps = {
              ...getEqlRuleForSignalTesting(['auditbeat-*']),
              query: 'configuration where host.name=="zeek-sensor-amsterdam"',
            };

            const createdRule = await createRuleWithExceptionEntries(supertest, log, rule, [
              [
                {
                  field: 'host.name',
                  operator: 'included',
                  type: 'list',
                  list: {
                    id: valueListId,
                    type: 'keyword',
                  },
                },
              ],
            ]);
            const signalsOpen = await getOpenSignals(supertest, log, es, createdRule);
            expect(signalsOpen.hits.hits.length).toEqual(0);
          });
          it('should Not allow deleting value list when there are references and ignoreReferences is false', async () => {
            const valueListId = 'value-list-id';
            await importFile(supertest, log, 'keyword', ['suricata-sensor-amsterdam'], valueListId);
            const rule: QueryRuleCreateProps = {
              ...getSimpleRule(),
              query: 'host.name: "suricata-sensor-amsterdam"',
            };
            await createRuleWithExceptionEntries(supertest, log, rule, [
              [
                {
                  field: 'host.name',
                  operator: 'included',
                  type: 'list',
                  list: {
                    id: valueListId,
                    type: 'keyword',
                  },
                },
              ],
            ]);

            const deleteReferences = false;
            const ignoreReferences = false;

            // Delete the value list
            await supertest
              .delete(
                `${LIST_URL}?deleteReferences=${deleteReferences}&id=${valueListId}&ignoreReferences=${ignoreReferences}`
              )
              .set('kbn-xsrf', 'true')
              .send()
              .expect(409);
          });
        });
      });
    });
    describe('Synchronizations', () => {
      afterEach(async () => {
        await deleteAllAlerts(supertest, log, es);
        await deleteAllRules(supertest, log);
        await deleteAllExceptions(supertest, log);
      });
      /*
        This test to mimic if we have two browser tabs, and the user tried to 
        edit an exception in a tab after deleting it in another 
      */
      it('should Not edit an exception after being deleted', async () => {
        const { list_id: skippedListId, ...newExceptionItem } =
          getCreateExceptionListDetectionSchemaMock();
        const {
          body: { id, list_id, namespace_type, type },
        } = await supertest
          .post(EXCEPTION_LIST_URL)
          .set('kbn-xsrf', 'true')
          .send(newExceptionItem)
          .expect(200);

        const ruleWithException: RuleCreateProps = {
          ...getSimpleRule(),
          exceptions_list: [
            {
              id,
              list_id,
              namespace_type,
              type,
            },
          ],
        };

        await createRule(supertest, log, ruleWithException);

        // Delete the exception
        await supertest
          .delete(`${EXCEPTION_LIST_ITEM_URL}?id=${id}&namespace_type=single`)
          .set('kbn-xsrf', 'true')
          .send()
          .expect(200);

        // Edit after delete as if it was opened in another browser tab
        const { body } = await supertest
          .put(`${EXCEPTION_LIST_ITEM_URL}`)
          .set('kbn-xsrf', 'true')
          .send({
            id: list_id,
            item_id: id,
            name: 'edit',
            entries: [{ field: 'ss', operator: 'included', type: 'match', value: 'ss' }],
            namespace_type,
            description: 'Exception list item - Edit',
            type: 'simple',
          })
          .expect(404);

        expect(body).toEqual({
          message: `exception list item id: "${list_id}" does not exist`,
          status_code: 404,
        });
      });
      /*
        This test to mimic if we have two browser tabs, and the user tried to 
        edit an exception with value-list was deleted in another tab
      */
      it('should Not allow editing an Exception with deleted ValueList', async () => {
        await createListsIndex(supertest, log);

        const valueListId = 'value-list-id';
        await importFile(supertest, log, 'keyword', ['suricata-sensor-amsterdam'], valueListId);
        const rule: QueryRuleCreateProps = {
          ...getSimpleRule(),
          query: 'host.name: "suricata-sensor-amsterdam"',
        };
        const { exceptions_list: exceptionsList } = await createRuleWithExceptionEntries(
          supertest,
          log,
          rule,
          [
            [
              {
                field: 'host.name',
                operator: 'included',
                type: 'list',
                list: {
                  id: valueListId,
                  type: 'keyword',
                },
              },
            ],
          ]
        );

        const deleteReferences = false;
        const ignoreReferences = true;

        const { id, list_id, namespace_type } = exceptionsList[0];

        // Delete the value list
        await supertest
          .delete(
            `${LIST_URL}?deleteReferences=${deleteReferences}&id=${valueListId}&ignoreReferences=${ignoreReferences}`
          )
          .set('kbn-xsrf', 'true')
          .send()
          .expect(200);

        // edit the exception with the deleted value list
        await supertest
          .put(`${EXCEPTION_LIST_ITEM_URL}`)
          .set('kbn-xsrf', 'true')
          .send({
            id: list_id,
            item_id: id,
            name: 'edit',
            entries: [
              {
                field: 'host.name',
                operator: 'included',
                type: 'list',
                list: {
                  id: valueListId,
                  type: 'keyword',
                },
              },
            ],
            namespace_type,
            description: 'Exception list item - Edit',
            type: 'simple',
          })
          .expect(404);

        await deleteListsIndex(supertest, log);
      });
    });

    describe('Add/edit exception comments by different users', () => {
      const socManager = ROLES.soc_manager;
      const detectionAdmin = ROLES.detections_admin;

      beforeEach(async () => {
        await createUserAndRole(getService, detectionAdmin);
        await createUserAndRole(getService, socManager);
      });

      afterEach(async () => {
        await deleteUserAndRole(getService, detectionAdmin);
        await deleteUserAndRole(getService, socManager);
        await deleteAllExceptions(supertest, log);
      });

      it('Add comment on a new exception, add another comment has unicode from a different user', async () => {
        await supertestWithoutAuth
          .post(EXCEPTION_LIST_URL)
          .auth(detectionAdmin, 'changeme')
          .set('kbn-xsrf', 'true')
          .send(getCreateExceptionListDetectionSchemaMock())
          .expect(200);

        const { os_types, ...ruleException } = getCreateExceptionListItemMinimalSchemaMock();

        // Add comment by the Detection Admin
        await supertestWithoutAuth
          .post(EXCEPTION_LIST_ITEM_URL)
          .auth(detectionAdmin, 'changeme')
          .set('kbn-xsrf', 'true')
          .send({
            ...ruleException,
            comments: [{ comment: 'Comment by user@detections_admin' }],
          })
          .expect(200);

        const { body: items } = await supertestWithoutAuth
          .get(
            `${EXCEPTION_LIST_ITEM_URL}/_find?list_id=${
              getCreateExceptionListMinimalSchemaMock().list_id
            }`
          )
          .auth(detectionAdmin, 'changeme')
          .set('kbn-xsrf', 'true')
          .send()
          .expect(200);

        // Validate the first user comment
        expect(items.total).toEqual(1);
        const [item] = items.data;
        const detectionAdminComments = item.comments;
        expect(detectionAdminComments.length).toEqual(1);

        expect(detectionAdminComments[0]).toEqual(
          expect.objectContaining({
            created_by: 'detections_admin',
            comment: 'Comment by user@detections_admin',
          })
        );

        const expectedId = item.id;

        // Update exception comment by different user Soc-manager
        const { item_id: _, ...updateItemWithoutItemId } =
          getUpdateMinimalExceptionListItemSchemaMock();

        const updatePayload: UpdateExceptionListItemSchema = {
          ...updateItemWithoutItemId,
          comments: [
            ...(updateItemWithoutItemId.comments || []),
            { comment: 'Comment by user@soc_manager' },
          ],
          id: expectedId,
        };
        await supertestWithoutAuth
          .put(EXCEPTION_LIST_ITEM_URL)
          .auth(socManager, 'changeme')
          .set('kbn-xsrf', 'true')
          .send(updatePayload)
          .expect(200);

        const { body: itemsAfterUpdate } = await supertest
          .get(
            `${EXCEPTION_LIST_ITEM_URL}/_find?list_id=${
              getCreateExceptionListMinimalSchemaMock().list_id
            }`
          )
          .auth(socManager, 'changeme')
          .set('kbn-xsrf', 'true')
          .send()
          .expect(200);
        const [itemAfterUpdate] = itemsAfterUpdate.data;
        const detectionAdminAndSocManagerComments = itemAfterUpdate.comments;

        expect(detectionAdminAndSocManagerComments.length).toEqual(2);

        expect(detectionAdminAndSocManagerComments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              created_by: 'detections_admin',
              comment: 'Comment by user@detections_admin',
            }),
            expect.objectContaining({
              created_by: 'soc_manager',
              comment: 'Comment by user@soc_manager',
            }),
          ])
        );
      });
    });
  });
};
