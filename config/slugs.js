'use strict';

// Key:   slugified Notion "Opportunity" title (see lib/formatter.slugify)
// Value: Slack channel name used for this deal.
//        For Pilot/Integration/Active-Won stages: this is the active channel.
//        If that channel doesn't exist when the deal reaches Pilot, the bot
//        creates it with this exact name (no prefix).
//        On Closed/Lost, the bot renames it to `closed-${value}` and archives.
module.exports = {
  'account-name':                                  'account-name',
  'jms-veteran-clinics':                           'jms',
  'atrius-health':                                 'atrius',
  'marin-health-pain-medicine':                    'marin-pain',
  'vip-medical-group':                             'vip',
  'umass-memorial-pain-medicine':                  'umass-pain',
  'maywell-health-pain-management':                'maywell',
  'johns-hopkins-blaustein-pain-treatment-center': 'johns-hopkins',
  'brigham-and-womens-hospital-pain-management':   'brigham',
  'uf-health-shands-hospital-anesthesiology':      'uf-shands',
  'mount-sinai-hospital-anesthesiology':           'mount-sinai',
  'dbhds-virginia':                                'dbhds',
  'childrens-hospital-of-michigan':                'michigan-childrens',
  'perdue-one-health':                             'perdue-one-health',
  'troy-medical':                                  'troy',
  'lifestance-health':                             'lifestance',
  'catholic-health':                               'catholic',
  'innovation-spine-medical':                      'innovation-spine',
  'lumin-health-ketamine-clinics':                 'lumin',
  'yale-dept-psychiatry':                          'yale-psych',
  'savas-health':                                  'savas',
  'sutter-health':                                 'sutter',
  'cambridge-health-alliance':                     'cambridge',
  'mclean-hospital':                               'mclean',
  'montreal-general':                              'montreal',
  'utsouthwest-pain-medicine':                     'utsouthwest',
  'massachusetts-general-hospital':                'mass-general',
  'hero-brain-health':                             'hero-brain',
  'mike-kritzer-private-clinic':                   'mike-clinic',
  'la-childrens-hospital':                         'la-childrens',
  'einstein-montefiore-hospital-pmr':              'montefiore',
};
