import codebuild = require('@aws-cdk/aws-codebuild');
import codecommit = require('@aws-cdk/aws-codecommit');
import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipeline_actions = require('@aws-cdk/aws-codepipeline-actions');
import { App, Stack, StackProps, CfnParameter, RemovalPolicy, Fn } from '@aws-cdk/core';
import * as core from '@aws-cdk/core';
import * as ecr from '@aws-cdk/aws-ecr';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';

const ArtifactS3Bucket = "ArtifactS3Bucket";
const ArtifactS3VersionKey = "ArtifactS3VersionKey";
const ArtifactS3Hash = "ArtifactS3Hash";

export interface PipelineStackProps extends StackProps {
  readonly devRepository: CfnParameter;
  //readonly qaRepository: CfnParameter;
  //readonly stagingRepository: CfnParameter;
  readonly devAccount: string;
  //readonly qaAccount: string;
  //readonly stagingAccount: string;
  //readonly lambdaCodeDev: lambda.CfnParametersCode;
  //readonly lambdaCodeQA: lambda.CfnParametersCode;
  //readonly lambdaCodeStaging: lambda.CfnParametersCode;
  //readonly assetDev: any; 
}

export class PipelineStack extends Stack {
  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props);

    const code = codecommit.Repository.fromRepositoryName(this, 'test-ecs-demo',
      'test-ecs-demo');

    const repositoryConstruct = new ecr.Repository(this, "SampleRepository", {
      repositoryName: "test-ecs-demo",
      removalPolicy: RemovalPolicy.DESTROY
    });

    const ecrPolicyStatement = new iam.PolicyStatement({
      actions: ["ecr:*"],
      principals: [
        new iam.AccountPrincipal(props.devAccount),
        //new iam.AccountPrincipal(props.qaAccount),
        //new iam.AccountPrincipal(props.stagingAccount)
      ]
    }); 


    repositoryConstruct.addToResourcePolicy(ecrPolicyStatement);


    const sourceOutput = new codepipeline.Artifact();
    const cdkBuildOutput = new codepipeline.Artifact('CdkBuildOutput');
    const lambdaBuildOutput = new codepipeline.Artifact('LambdaBuildOutput');
    const javaBuildOutput = new codepipeline.Artifact('JavaBuildOutput');
    const assetBuildOutput = new codepipeline.Artifact('AssetBuildOutput');



    const cdkBuild = new codebuild.PipelineProject(this, 'CdkBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'cd infrastructure',
              'npm install',
            ],
          },
          build: {
            commands: [
              'npm run build',
              'npm run cdk synth -- -o dist',
              'cd dist',
              'mkdir myartifact',
              'cp asset*/* myartifact'
            ],
          },
        },
        artifacts: {
        'secondary-artifacts': {
            CdkBuildOutput: {
              'base-directory': 'infrastructure/dist',
              files: [
                'SafeApiDevStack.template.json',
                'SafeApiQAStack.template.json',
                'SafeApiStagingStack.template.json',
              ],
            },            
            AssetBuildOutput: {
              'base-directory': 'infrastructure/dist/myartifact',
              files: [
                '*'
              ],
              
            }
          }
        }
        /*artifacts: {
          'base-directory': 'infrastructure/dist',
          files: [
            'SafeApiDevStack.template.json',
            'SafeApiQAStack.template.json',
            'SafeApiStagingStack.template.json',
          ],
        },*/
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_NODEJS_10_14_1,
      },
    });
    const javaBuild = new codebuild.PipelineProject(this, 'JavaBuild', {
      environmentVariables: {
        ECR_REPOSITORY_URI: {value: repositoryConstruct.repositoryUri}
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
                java: 'corretto11',
                docker: '18'    
            }
          },
          pre_build: {
            commands: [
                'echo Logging in to Amazon ECR...',
                'aws --version',
                'echo $ECR_REPOSITORY_URI',
                '$(aws ecr get-login --region $AWS_DEFAULT_REGION --no-include-email)',
                'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
                'IMAGE_TAG=${COMMIT_HASH:=latest}',
                'echo $IMAGE_TAG'
            ]
          },
          build: {
            commands: [
                'echo Build started on `date`',
                'echo Building Java',
                './gradlew build',
                'dir build/libs',
                'docker build -t $ECR_REPOSITORY_URI:latest .',
                'docker tag $ECR_REPOSITORY_URI:latest $ECR_REPOSITORY_URI:$IMAGE_TAG'
            ]
          },
          post_build: {
              commands: [
                'echo Build completed on `date`',
                'echo Pushing the Docker images...',
                'docker push $ECR_REPOSITORY_URI:$IMAGE_TAG',
                'printf \'{"ImageURI":"%s:%s"}\' $ECR_REPOSITORY_URI $IMAGE_TAG > imageDetail.json'
              ]
          }
        },
        artifacts: {
          files: [
            'imageDetail.json'
          ],
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
        privileged: true
      },
    });

    const policyStatement = new iam.PolicyStatement({
      resources: [repositoryConstruct.repositoryArn],
      actions: ["ecr:*"]
    }); 

    const policyStatementToken = new iam.PolicyStatement({
      resources: ["*"],
      actions: ["ecr:GetAuthorizationToken"]
    });

    javaBuild.addToRolePolicy(
      policyStatement
    );

    javaBuild.addToRolePolicy(
      policyStatementToken
    );

    new codepipeline.Pipeline(this, 'ApiPipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeCommitSourceAction({
              actionName: 'CodeCommit_Source',
              repository: code,
              branch: 'master',
              output: sourceOutput,
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'SafeApi_Java_Build',
              project: javaBuild,
              input: sourceOutput,
              outputs: [javaBuildOutput],
            }),
            new codepipeline_actions.CodeBuildAction({
              actionName: 'SafeApi_CDK_Build',
              project: cdkBuild,
              input: sourceOutput,
              outputs: [cdkBuildOutput, lambdaBuildOutput, assetBuildOutput],
              //outputs: [cdkBuildOutput],
            }),
          ],
        },
        {
          stageName: 'DeployDev',
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: 'Java_CFN_Deploy',
              templatePath: cdkBuildOutput.atPath('SafeApiDevStack.template.json'),
              stackName: 'SafeApiDevStack',
              adminPermissions: true,
              parameterOverrides: {
                //[props.devRepository.logicalId]: javaBuildOutput.getParam('imageDetail.json', 'ImageURI'),
                
                [ArtifactS3Bucket]: assetBuildOutput.bucketName,
                [ArtifactS3VersionKey]: assetBuildOutput.objectKey,
                [ArtifactS3Hash]: "1"
                             
              },
              extraInputs: [javaBuildOutput, lambdaBuildOutput, cdkBuildOutput, assetBuildOutput],
              account: props.devAccount
              
            }),
          ],
        },
        /*{
          stageName: "ApproveDeployQA",
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: 'ApproveDeployQA',
              notifyEmails: [
                'oconnor@railroad19.com',
              ], // optional
              additionalInformation: 'Deploy to QA approval', // optional
            })
          ]
        },
        {
          stageName: "DeployQA",
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: 'Java_CFN_Deploy_QA',
              templatePath: cdkBuildOutput.atPath('SafeApiQAStack.template.json'),
              stackName: 'SafeApiQAStack',
              adminPermissions: true,
              parameterOverrides: {
                [props.qaRepository.logicalId]: javaBuildOutput.getParam('imageDetail.json', 'ImageURI'),
                ...props.lambdaCodeQA.assign(lambdaBuildOutput.s3Location),
                [ArtifactS3Bucket]: assetBuildOutput.bucketName,
                [ArtifactS3VersionKey]: assetBuildOutput.objectKey,
                [ArtifactS3Hash]: "1"

              },
              extraInputs: [javaBuildOutput, lambdaBuildOutput, cdkBuildOutput, assetBuildOutput],
              account: props.qaAccount              
            }),
          ],
        },
        {
          stageName: "ApproveDeployStaging",
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: 'ApproveDeployStaging',
              notifyEmails: [
                'oconnor@railroad19.com',
              ], // optional
              additionalInformation: 'Deploy to Staging approval', // optional
            })
          ]
        },
        {
          stageName: "DeployStaging",
          actions: [
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: 'Java_CFN_Deploy_Staging',
              templatePath: cdkBuildOutput.atPath('SafeApiStagingStack.template.json'),
              stackName: 'SafeApiStagingStack',
              adminPermissions: true,
              parameterOverrides: {
                [props.stagingRepository.logicalId]: javaBuildOutput.getParam('imageDetail.json', 'ImageURI'),
                ...props.lambdaCodeStaging.assign(lambdaBuildOutput.s3Location),
                [ArtifactS3Bucket]: assetBuildOutput.bucketName,
                [ArtifactS3VersionKey]: assetBuildOutput.objectKey,
                [ArtifactS3Hash]: "1"

              },
              extraInputs: [javaBuildOutput, lambdaBuildOutput, cdkBuildOutput, assetBuildOutput],
              account: props.stagingAccount              
            }),
          ],
        },*/

      ],
    });
  }
}
