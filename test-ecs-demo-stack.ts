import * as cdk from '@aws-cdk/core';

import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as alb from '@aws-cdk/aws-elasticloadbalancingv2';
import * as iam from '@aws-cdk/aws-iam';
import * as rds from '@aws-cdk/aws-rds';
import { Fn, Duration, IConstruct, CfnParameter, IAspect } from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as sqs from '@aws-cdk/aws-sqs';
import * as kinesis from '@aws-cdk/aws-kinesis';
import { VpcAttributes } from '@aws-cdk/aws-ec2';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';

export interface InfrastructureProps {  
  readonly environmentName: string;
  readonly nbcEnvironment: boolean;
  readonly vpcDescription: VpcAttributes;
  readonly taskRoleArn: string;
  readonly executionRoleArn: string;
}

export class TestEcsDemoStack extends cdk.Stack {
	
	public readonly parameterRegistry: cdk.CfnParameter;
	
  	constructor(scope: cdk.Construct, id: string, props: cdk.StackProps, private infrastructureProps: InfrastructureProps) {
    super(scope, id, props);

    /*this.parameterRegistry  = new cdk.CfnParameter(this, "RegisteryParameter", {
      type: ''
  });*/
	
	const vpc = ec2.Vpc.fromVpcAttributes(this, "VPC", infrastructureProps.vpcDescription);
	
	const appendToName = infrastructureProps.nbcEnvironment ? "Api" : "";

    const loadBalancerSecurityGroupId = Fn.importValue(this.exportName("SafeLoadBalancerSecurityGroup" + appendToName));
    //const clusterName = Fn.importValue(this.exportName("SafeEcsClusterName"));
	const clusterName = "testcluster";
    const fargateSecurityGroupId = Fn.importValue(this.exportName("SafeFargateSecurityGroup" ));

    
    const fargateSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, "FargateSecurityGroup", fargateSecurityGroupId);
	
    const loadBalancerSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, "LoadBalancerSecurityGroup", 
      loadBalancerSecurityGroupId);

      const safeListenerArn = Fn.importValue(this.exportName("SafeListener"+appendToName));
      const applicationListener = alb.ApplicationListener.fromApplicationListenerAttributes(this, "ApplicationListener", {
        listenerArn: safeListenerArn,
        securityGroup: loadBalancerSecurityGroup
      });
      /*const targetGroup = new alb.ApplicationTargetGroup(this, "TargetGroup", {
        targetType: alb.TargetType.IP,
        protocol: alb.ApplicationProtocol.HTTP,
        vpc,
        healthCheck: {path: '/actuator/health/'}
      });*/alb
	 const targetGroup = "dev-cacheapi-target";

	 /*targetGroup.addTarget(service);

      applicationListener.addTargetGroups("AppListenerTargetGroup", {
          targetGroups: [targetGroup],
          pathPattern: "/licensee/*",
          priority: 10
      });*/
  
    const cluster = ecs.Cluster.fromClusterAttributes(
      this, "Cluster", {
		vpc,
        clusterName,
        securityGroups: []
      }
    );


    const executionRole = infrastructureProps.executionRoleArn !== undefined ? 
    iam.Role.fromRoleArn(this, "FargateExecutionRole", 
        infrastructureProps.executionRoleArn, {mutable: false}) : 
    new iam.Role(this, "FargateExecutionRole", 
      {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName("SecretsManagerReadWrite"),
          iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLogsFullAccess"),
          iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly")
        ]
      });

      // arn:aws:iam::759570236286:role/ecsTaskExecutionRole

      const taskRole = infrastructureProps.taskRoleArn !==  undefined ? iam.Role.fromRoleArn(this, "FargateTaskRole", 
        infrastructureProps.taskRoleArn, {mutable: false}) : new iam.Role(this, "FargateTaskRole", {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com")
      });
      

    const taskDefinition = new ecs.FargateTaskDefinition(this, "FargateTask", {
		family: "test-ecs-demo-task",
		memoryLimitMiB: 2048,
      	cpu: 512,
      	executionRole,
      	taskRole
    });

    const logging = new ecs.AwsLogDriver({streamPrefix: this.node.id});

    const container = taskDefinition.addContainer("FargateContainer1", {
      image: ecs.ContainerImage.fromRegistry("985218050846.dkr.ecr.us-west-2.amazonaws.com/test-ecs-demo:latest"),
      logging,
      environment: {
        
      }
    });
	
	container.addPortMappings({containerPort: 8080});

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
	  serviceName : "test-ecs-demo-service"
    });

  }

  private exportName(base: string) {
    const envName = this.infrastructureProps.environmentName;
    return envName + "-" + base;
  }
}