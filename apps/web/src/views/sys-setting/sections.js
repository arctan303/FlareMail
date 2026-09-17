// 系统设置的分区定义：二级侧边栏与设置页共用，避免两处各写一份。
// label / desc 存的是 i18n 键，消费方用 $t() 取值。
export const SYS_SETTING_SECTIONS = [
    {
        id: 'core',
        label: 'sysSectionCore',
        icon: 'solar:server-square-linear',
        desc: 'sysSectionCoreDesc',
    },
    {
        id: 'brand',
        label: 'sysSectionBrand',
        icon: 'solar:widget-2-linear',
        desc: 'sysSectionBrandDesc',
    },
    {
        id: 'domains',
        label: 'sysSectionDomains',
        icon: 'solar:mailbox-linear',
        desc: 'sysSectionDomainsDesc',
    },
    {
        id: 'mail',
        label: 'sysSectionMail',
        icon: 'solar:letter-linear',
        desc: 'sysSectionMailDesc',
    },
    {
        id: 'auth',
        label: 'sysSectionAuth',
        icon: 'solar:key-linear',
        desc: 'sysSectionAuthDesc',
    },
    {
        id: 'maintenance',
        label: 'sysSectionMaintenance',
        icon: 'solar:refresh-circle-linear',
        desc: 'sysSectionMaintenanceDesc',
    },
]

export const SYS_SETTING_DEFAULT_SECTION = 'core'

export function resolveSysSettingSection(id) {
    return SYS_SETTING_SECTIONS.some(section => section.id === id) ? id : SYS_SETTING_DEFAULT_SECTION
}

export function getSysSettingSection(id) {
    const resolved = resolveSysSettingSection(id)
    return SYS_SETTING_SECTIONS.find(section => section.id === resolved) || SYS_SETTING_SECTIONS[0]
}
