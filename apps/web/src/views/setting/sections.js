// 个人设置的分区定义：二级侧边栏与个人设置页共用
// label / desc 存的是 i18n 键，消费方用 $t() 取值。
export const USER_SETTING_SECTIONS = [
  {
    id: 'profile',
    label: 'userSectionProfile',
    icon: 'solar:user-id-linear',
    desc: 'userSectionProfileDesc',
  },
  {
    id: 'appearance',
    label: 'userSectionAppearance',
    icon: 'solar:pallete-2-linear',
    desc: 'userSectionAppearanceDesc',
  },
  {
    id: 'mailboxes',
    label: 'userSectionMailboxes',
    icon: 'solar:mailbox-linear',
    desc: 'userSectionMailboxesDesc',
  },
  {
    id: 'security',
    label: 'userSectionSecurity',
    icon: 'solar:shield-check-linear',
    desc: 'userSectionSecurityDesc',
  },
]

export const USER_SETTING_DEFAULT_SECTION = 'profile'

export function resolveUserSettingSection(id) {
  return USER_SETTING_SECTIONS.some(section => section.id === id) ? id : USER_SETTING_DEFAULT_SECTION
}

export function getUserSettingSection(id) {
  const resolved = resolveUserSettingSection(id)
  return USER_SETTING_SECTIONS.find(section => section.id === resolved) || USER_SETTING_SECTIONS[0]
}
