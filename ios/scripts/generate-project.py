#!/usr/bin/env python3
"""Generate the checked-in Xcode project with the Python standard library only."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
objects = {}
def uid(key):
    return hashlib.sha1(key.encode()).hexdigest()[:24].upper()
def quote(value):
    return json.dumps(str(value), ensure_ascii=False)
def add(key, isa, **fields):
    ident = uid(key)
    objects[ident] = {'isa': isa, **fields}
    return ident
class Raw(str):
    pass
def render(value):
    if isinstance(value, Raw): return str(value)
    if isinstance(value, list): return '(' + ', '.join(render(v) for v in value) + (',)' if value else ')')
    if isinstance(value, dict): return '{ ' + ' '.join(f'{quote(k)} = {render(v)};' for k,v in value.items()) + ' }'
    return quote(value)
def ref(value): return Raw(value)

def file_ref(path):
    suffix = Path(path).suffix
    filetype = {'.swift':'sourcecode.swift', '.xcassets':'folder.assetcatalog', '.icon':'folder.iconcomposer.icon', '.md':'text', '.xcprivacy':'text.xml', '.xcconfig':'text.xcconfig'}.get(suffix,'text')
    return add('file:'+path, 'PBXFileReference', lastKnownFileType=filetype, path=path, sourceTree='<group>')

config_file = file_ref('Config/App.xcconfig')
groups = []
products = []
targets = []
for name in ['FreeBBS','FreeBBSTests','FreeBBSUITests']:
    source_files = [file_ref(str(p.relative_to(ROOT))) for p in sorted((ROOT/name).rglob('*.swift'))]
    resource_files = []
    if name == 'FreeBBS':
        resource_files = [file_ref('FreeBBS/Resources/'+s) for s in ['Assets.xcassets','FreeBBSIcon.icon','PrivacyInfo.xcprivacy','PrivacyPolicy.md','CommunityAgreement.md','RichContent.html','RendererLicenses.txt']]
    children = source_files + resource_files
    groups.append(add('group:'+name,'PBXGroup', name=name, children=[ref(v) for v in children], sourceTree='<group>'))
    source_build = [add('build:'+name+':'+v,'PBXBuildFile',fileRef=ref(v)) for v in source_files]
    resource_build = [add('resource:'+v,'PBXBuildFile',fileRef=ref(v)) for v in resource_files]
    phases = [add('sources:'+name,'PBXSourcesBuildPhase',buildActionMask=Raw('2147483647'),files=[ref(v) for v in source_build],runOnlyForDeploymentPostprocessing=Raw('0')),
              add('frameworks:'+name,'PBXFrameworksBuildPhase',buildActionMask=Raw('2147483647'),files=[],runOnlyForDeploymentPostprocessing=Raw('0')),
              add('resources:'+name,'PBXResourcesBuildPhase',buildActionMask=Raw('2147483647'),files=[ref(v) for v in resource_build],runOnlyForDeploymentPostprocessing=Raw('0'))]
    app = name == 'FreeBBS'
    product = add('product:'+name,'PBXFileReference',explicitFileType='wrapper.application' if app else 'wrapper.cfbundle',includeInIndex=Raw('0'),path=name+('.app' if app else '.xctest'),sourceTree='BUILT_PRODUCTS_DIR')
    products.append(product)
    configs = []
    for config in ['Debug','Release']:
        settings = {'PRODUCT_NAME':'$(TARGET_NAME)','SDKROOT':'iphoneos','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','SWIFT_VERSION':'6.0','IPHONEOS_DEPLOYMENT_TARGET':'26.0','TARGETED_DEVICE_FAMILY':'1','CODE_SIGN_STYLE':'Automatic','DEVELOPMENT_TEAM':'Q83556V27Y','SWIFT_STRICT_CONCURRENCY':'complete'}
        if app:
            settings.update({'INFOPLIST_FILE':'FreeBBS/Resources/Info.plist','GENERATE_INFOPLIST_FILE':'NO','ASSETCATALOG_COMPILER_APPICON_NAME':'FreeBBSIcon','ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME':'AccentColor','ENABLE_PREVIEWS':'YES','SWIFT_EMIT_LOC_STRINGS':'YES'})
        else:
            settings.update({'PRODUCT_BUNDLE_IDENTIFIER':f'cn.free-bbs.app.{name}','GENERATE_INFOPLIST_FILE':'YES'})
            if name == 'FreeBBSTests': settings.update({'TEST_HOST':'$(BUILT_PRODUCTS_DIR)/FreeBBS.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/FreeBBS','BUNDLE_LOADER':'$(TEST_HOST)'})
            else: settings['TEST_TARGET_NAME'] = 'FreeBBS'
        settings['SWIFT_OPTIMIZATION_LEVEL'] = '-Onone' if config == 'Debug' else '-O'
        if config == 'Debug': settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = 'DEBUG $(inherited)'
        else: settings['DEBUG_INFORMATION_FORMAT'] = 'dwarf-with-dsym'
        kwargs = {'baseConfigurationReference':ref(config_file)} if app else {}
        configs.append(add('config:'+name+':'+config,'XCBuildConfiguration',name=config,buildSettings=settings,**kwargs))
    configlist = add('configlist:'+name,'XCConfigurationList',buildConfigurations=[ref(v) for v in configs],defaultConfigurationIsVisible=Raw('0'),defaultConfigurationName='Release')
    dependencies = []
    if not app:
        proxy = add('proxy:'+name,'PBXContainerItemProxy',containerPortal=ref(uid('project')),proxyType=Raw('1'),remoteGlobalIDString=ref(uid('target:FreeBBS')),remoteInfo='FreeBBS')
        dependencies.append(add('dependency:'+name,'PBXTargetDependency',target=ref(uid('target:FreeBBS')),targetProxy=ref(proxy)))
    target = add('target:'+name,'PBXNativeTarget',buildConfigurationList=ref(configlist),buildPhases=[ref(v) for v in phases],buildRules=[],dependencies=[ref(v) for v in dependencies],name=name,productName=name,productReference=ref(product),productType='com.apple.product-type.application' if app else ('com.apple.product-type.bundle.unit-test' if name == 'FreeBBSTests' else 'com.apple.product-type.bundle.ui-testing'))
    targets.append(target)
productgroup = add('products','PBXGroup',name='Products',children=[ref(v) for v in products],sourceTree='<group>')
main = add('main','PBXGroup',children=[ref(config_file)]+[ref(v) for v in groups]+[ref(productgroup)],sourceTree='<group>')
projectconfigs = []
for config in ['Debug','Release']:
    projectconfigs.append(add('projectconfig:'+config,'XCBuildConfiguration',name=config,buildSettings={'CLANG_ENABLE_MODULES':'YES','ENABLE_TESTABILITY':'YES' if config == 'Debug' else 'NO','SWIFT_VERSION':'6.0','SWIFT_STRICT_CONCURRENCY':'complete','GCC_PREPROCESSOR_DEFINITIONS':['$(inherited)']}))
projectconfiglist = add('projectconfiglist','XCConfigurationList',buildConfigurations=[ref(v) for v in projectconfigs],defaultConfigurationIsVisible=Raw('0'),defaultConfigurationName='Release')
add('project','PBXProject',attributes={'BuildIndependentTargetsInParallel':'YES','LastUpgradeCheck':'2600'},buildConfigurationList=ref(projectconfiglist),compatibilityVersion='Xcode 14.0',developmentRegion='zh-Hans',hasScannedForEncodings=Raw('0'),knownRegions=['zh-Hans','en','Base'],mainGroup=ref(main),productRefGroup=ref(productgroup),projectDirPath='',projectRoot='',targets=[ref(v) for v in targets])
project = ROOT/'FreeBBS.xcodeproj'
project.mkdir(exist_ok=True)
content = '// !$*UTF8*$!\n{\n archiveVersion = 1;\n classes = {};\n objectVersion = 56;\n objects = {\n'
content += ''.join(f'  {ident} = {render(value)};\n' for ident,value in sorted(objects.items()))
content += f' }};\n rootObject = {uid("project")};\n}}\n'
(project/'project.pbxproj').write_text(content)
scheme = ET.Element('Scheme',LastUpgradeVersion='2600',version='1.3')
build = ET.SubElement(scheme,'BuildAction',parallelizeBuildables='YES',buildImplicitDependencies='YES')
entries = ET.SubElement(build,'BuildActionEntries')
def buildable(parent,name):
    ET.SubElement(parent,'BuildableReference',BuildableIdentifier='primary',BlueprintIdentifier=uid('target:'+name),BuildableName=name+('.app' if name == 'FreeBBS' else '.xctest'),BlueprintName=name,ReferencedContainer='container:FreeBBS.xcodeproj')
entry = ET.SubElement(entries,'BuildActionEntry',buildForTesting='YES',buildForRunning='YES',buildForProfiling='YES',buildForArchiving='YES',buildForAnalyzing='YES')
buildable(entry,'FreeBBS')
testaction = ET.SubElement(scheme,'TestAction',buildConfiguration='Debug',selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB',selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB',shouldUseLaunchSchemeArgsEnv='YES')
testables=ET.SubElement(testaction,'Testables')
for name in ['FreeBBSTests','FreeBBSUITests']:
    buildable(ET.SubElement(testables,'TestableReference',skipped='NO',parallelizable='NO'),name)
launch = ET.SubElement(scheme,'LaunchAction',buildConfiguration='Debug',selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB',selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB',launchStyle='0',useCustomWorkingDirectory='NO',ignoresPersistentStateOnLaunch='NO',debugDocumentVersioning='YES',debugServiceExtension='internal',allowLocationSimulation='YES')
buildable(ET.SubElement(launch,'BuildableProductRunnable',runnableDebuggingMode='0'),'FreeBBS')
ET.SubElement(scheme,'ProfileAction',buildConfiguration='Release',shouldUseLaunchSchemeArgsEnv='YES',savedToolIdentifier='',useCustomWorkingDirectory='NO',debugDocumentVersioning='YES')
ET.SubElement(scheme,'AnalyzeAction',buildConfiguration='Debug')
ET.SubElement(scheme,'ArchiveAction',buildConfiguration='Release',revealArchiveInOrganizer='YES')
schemepath = project/'xcshareddata/xcschemes'
schemepath.mkdir(parents=True,exist_ok=True)
ET.indent(scheme)
ET.ElementTree(scheme).write(schemepath/'FreeBBS.xcscheme',encoding='UTF-8',xml_declaration=True)
print('Generated ios/FreeBBS.xcodeproj')
